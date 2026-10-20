# Developer-only read probe. Reuses existing Office X binaries; does not build or install anything.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$NativeDirectory,
 [Parameter(Mandatory=$true)][string]$NodePath,
 [Parameter(Mandatory=$true)][string]$ExpectedDocumentName,
 [string]$ReportPath
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$utf8=[Text.UTF8Encoding]::new($false)
$port=$null;$child=$null;$inputWriter=$null;$app=$null;$window=$null;$selection=$null;$selectedRange=$null;$selectedDocument=$null
$report=[ordered]@{schemaVersion=1;status='blocked';actualWordRead=$false;office2016Verified=$false;nascaVerified=$false;documentWritesDispatched=0;nativeCalls=0;error=$null}

function Error-Code($Failure) {
 $cause=$Failure.Exception
 while($null -ne $cause.InnerException){$cause=$cause.InnerException}
 if($cause.Message -cmatch '^[a-z][a-z0-9_]{1,80}$'){return $cause.Message}
 return 'native_read_failed'
}
function Release-Com($Value) {
 if($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value)}
}
function Identity($Value) {
 $pointer=[Runtime.InteropServices.Marshal]::GetIUnknownForObject($Value)
 try{return $pointer.ToInt64().ToString()}finally{[void][Runtime.InteropServices.Marshal]::Release($pointer)}
}
try {
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'windows_required'}
 if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -lt 5){throw 'windows_powershell_5_required'}
 if([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA){throw 'sta_required'}
 $nativeRoot=(Resolve-Path -LiteralPath $NativeDirectory).Path
 $node=(Resolve-Path -LiteralPath $NodePath).Path
 $nodeVersion=(& $node --version | Out-String).Trim();$nodeMatch=[regex]::Match($nodeVersion,'^v(\d+)\.(\d+)\.(\d+)$')
 if($LASTEXITCODE -ne 0 -or !$nodeMatch.Success){throw 'node_version_unavailable'}
 if([int]$nodeMatch.Groups[1].Value -lt 22 -or ([int]$nodeMatch.Groups[1].Value -eq 22 -and [int]$nodeMatch.Groups[2].Value -lt 19)){throw 'node_22_19_required'}
 $entry=Join-Path $PSScriptRoot 'read-word-native.mjs'
 $bundle=Join-Path (Split-Path $PSScriptRoot -Parent) 'dist/index.js'
 if(!(Test-Path -LiteralPath $entry -PathType Leaf) -or !(Test-Path -LiteralPath $bundle -PathType Leaf)){throw 'reader_build_required'}
 $hashes=[ordered]@{}
 foreach($name in @('Newtonsoft.Json.dll','OfficeX.Core.dll','OfficeX.ExcelHost.dll')) {
  $path=Join-Path $nativeRoot $name
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'native_dependency_missing'}
  $hashes[$name]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $assembly=[Reflection.Assembly]::LoadFrom($path)
  if($name -eq 'OfficeX.Core.dll'){$core=$assembly}
  if($name -eq 'OfficeX.ExcelHost.dll'){$hostAssembly=$assembly}
 }
 $dispatchGet=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeDispatch',$true).GetMethod('Get',[Reflection.BindingFlags]'Public,Static')
 function Native-Get($Object,[string]$Member) {
  return ,$dispatchGet.Invoke($null,[object[]]@($Object,$Member,[object[]]@()))
 }
 # Attach only to an already running Word. No Documents.Open, New, Activate, Save, Close or Quit.
 $app=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
 $windowType=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeWindow',$true)
 $window=$windowType.GetMethod('GetActiveWindow').Invoke($null,[object[]]@($app))
 $hwnd=$windowType.GetMethod('Handle').Invoke($null,[object[]]@($window,'word'))
 $portType=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeAutomationPort',$true)
 $port=[Activator]::CreateInstance($portType,[Reflection.BindingFlags]'Instance,Public,NonPublic',$null,[object[]]@($app,'word',$hwnd),[Globalization.CultureInfo]::InvariantCulture)
 $document=$portType.GetProperty('BoundDocument').GetValue($port,$null)
 if((Native-Get $document 'Name') -cne $ExpectedDocumentName){throw 'expected_document_mismatch'}
 $documentId=[string]$portType.GetProperty('DocumentId').GetValue($port,$null)
 $savedBefore=[bool](Native-Get $document 'Saved')
 $wordVersion=[string](Native-Get $app 'Version')
 $selection=Native-Get $app 'Selection';$selectedRange=Native-Get $selection 'Range'
 $selectedDocument=Native-Get $selectedRange 'Document'
 if((Identity $selectedDocument) -cne $documentId){throw 'selection_document_mismatch'}
 $rangeStart=[int](Native-Get $selectedRange 'Start');$rangeEnd=[int](Native-Get $selectedRange 'End');$story=[int](Native-Get $selectedRange 'StoryType')
 if($story -ne 1 -or $rangeStart -lt 0 -or $rangeEnd -le $rangeStart -or $rangeEnd-$rangeStart -gt 512){throw 'select_main_body_1_to_512_required'}
 $sessionType=$core.GetType('OfficeX.Core.OfficeAutomationSession',$true)
 $session=[Activator]::CreateInstance($sessionType,[object[]]@($port))
 $inspectMethod=$sessionType.GetMethod('Inspect');$membersMethod=$portType.GetMethod('Members')
 $checkMethod=$portType.GetMethod('CheckSource');$jsonMethod=$core.GetType('OfficeX.Core.Wire',$true).GetMethod('Json')
 $stepType=$core.GetType('OfficeX.Core.OfficeStep',$true)
 $listType=[Type]::GetType('System.Collections.Generic.List`1').MakeGenericType([Type[]]@($stepType))
 $runId=[Guid]::NewGuid().ToString('N')
 $start=@{type='word_read_start';runId=$runId;environment='windows-office';connection=@{
  scope=@{projectId='native-read-probe';taskId=$runId};targetRef='host-document:active-word';leaseId=[Guid]::NewGuid().ToString('N');app='word';
  officeSessionId=[Guid]::NewGuid().ToString('N');documentId=$documentId;range=@{start=$rangeStart;end=$rangeEnd;storyType=1}
 }}
 $psi=[Diagnostics.ProcessStartInfo]::new()
 $psi.FileName=$node;$psi.Arguments='"'+$entry+'"';$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
 $psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.StandardOutputEncoding=$utf8;$psi.RedirectStandardError=$true
 # Drop NODE_OPTIONS and unrelated inherited credentials/preload configuration.
 $psi.EnvironmentVariables.Clear()
 foreach($name in @('SystemRoot','WINDIR','SystemDrive','TEMP','TMP','PATH')) {
  $value=[Environment]::GetEnvironmentVariable($name)
  if($null -ne $value){$psi.EnvironmentVariables[$name]=$value}
 }
 $child=[Diagnostics.Process]::Start($psi)
 $discardedErrors=$child.StandardError.ReadToEndAsync()
 $inputWriter=[IO.StreamWriter]::new($child.StandardInput.BaseStream,$utf8);$inputWriter.AutoFlush=$true
 $inputWriter.WriteLine(($start|ConvertTo-Json -Compress -Depth 12))
 $handles=@{document='document'};$result=$null
 while($null -ne ($line=$child.StandardOutput.ReadLine())) {
  if($line.Length -gt 300000){throw 'native_frame_invalid'}
  $message=$line|ConvertFrom-Json
  if($message.runId -cne $runId){throw 'native_run_mismatch'}
  if($message.type -eq 'word_read_result'){$result=$message.result;break}
  if($message.type -ne 'tool' -or $message.id -notmatch '^[a-zA-Z0-9-]{1,160}$'){throw 'native_frame_invalid'}
  $response=$null
  try {
   [void]$checkMethod.Invoke($port,[object[]]@())
   if($message.name -eq 'inspect_office_members') {
    $queryInput=$message.input
    if(!$handles.ContainsKey([string]$queryInput.target) -or $queryInput.query -notmatch '^[a-zA-Z0-9_]{0,100}$' -or [int]$queryInput.count -lt 1 -or [int]$queryInput.count -gt 200){throw 'native_query_invalid'}
    $response=$membersMethod.Invoke($port,[object[]]@([string]$queryInput.target,[string]$queryInput.query,[int]$queryInput.count))
   } elseif($message.name -eq 'inspect_office') {
    $steps=@($message.input.steps)
    if($steps.Count -lt 1 -or $steps.Count -gt 256){throw 'native_steps_invalid'}
    $list=[Activator]::CreateInstance($listType)
    foreach($item in $steps) {
     if($item.action -cne 'get' -or !$handles.ContainsKey([string]$item.target)){throw 'native_read_getter_required'}
     $kind=$handles[[string]$item.target];$newKind=$null
     switch($kind) {
      'document' {
       if($item.member -cne 'Range' -or @($item.args).Count -ne 2){throw 'native_scope_unsupported'}
       $a=$item.args[0];$b=$item.args[1]
       if($a -isnot [ValueType] -or $b -isnot [ValueType] -or [double]$a -ne [int]$a -or [double]$b -ne [int]$b -or $a -lt $rangeStart -or $b -gt $rangeEnd -or $b -lt $a){throw 'native_range_mismatch'}
       $newKind='range'
      }
      'range' {
       if($item.member -cnotin @('Text','Start','End','StoryType','Fields.Count','InlineShapes.Count','ContentControls.Count','Tables.Count','Font','ParagraphFormat')){throw 'native_scope_unsupported'}
       if($item.member -ceq 'Font'){$newKind='font'}
       if($item.member -ceq 'ParagraphFormat'){$newKind='paragraph'}
      }
      'font' {if($item.member -cnotin @('Name','Size','Bold','Italic','Underline','Color')){throw 'native_scope_unsupported'}}
      'paragraph' {if($item.member -cnotin @('Alignment','SpaceBefore','SpaceAfter','LeftIndent','RightIndent')){throw 'native_scope_unsupported'}}
      default {throw 'native_scope_unsupported'}
     }
     if($kind -ne 'document' -and $item.PSObject.Properties.Name -contains 'args' -and @($item.args).Count -gt 0){throw 'native_arguments_invalid'}
     $step=[Activator]::CreateInstance($stepType)
     $step.Target=[string]$item.target;$step.Action='get';$step.Member=[string]$item.member
     if($null -ne $newKind) {
      if($item.id -notmatch '^nubi_[a-f0-9]{32}_[a-z0-9_]{1,40}$'){throw 'native_handle_invalid'}
      $step.Id=[string]$item.id;$handles[$step.Id]=$newKind
     } elseif($item.PSObject.Properties.Name -contains 'id'){throw 'native_handle_invalid'}
     if($kind -eq 'document'){$step.Args=[Newtonsoft.Json.Linq.JArray]::Parse(($item.args|ConvertTo-Json -Compress))}
     $list.Add($step)
    }
    $response=$inspectMethod.Invoke($session,([object[]](,$list)))
   } else {throw 'native_read_tool_required'}
   $report.nativeCalls++
  } catch {$response=@{ok=$false;error=(Error-Code $_)}}
  $payload=$jsonMethod.Invoke($null,[object[]]@($response))
  $envelope='{"type":"tool_result","runId":"'+$runId+'","id":"'+$message.id+'","result":'+$payload+'}'
  $inputWriter.WriteLine($envelope)
 }
 if($null -eq $result){throw 'native_connection_closed'}
 if(!$child.WaitForExit(5000)){throw 'reader_exit_unconfirmed'}
 if($child.ExitCode -ne 0 -or $result.status -ne 'read'){if($result.PSObject.Properties.Name -contains 'error' -and $result.error -cmatch '^[a-z][a-z0-9_]{1,80}$'){throw [string]$result.error};throw 'native_reader_failed'}
 [void]$checkMethod.Invoke($port,[object[]]@())
 if([bool](Native-Get $document 'Saved') -ne $savedBefore){throw 'source_state_changed'}
 if($result.environment -cne 'windows-office' -or $result.evidence.consistency -cne 'two_pass_match' -or !$result.leaseReleased -or $report.nativeCalls -lt 3){throw 'native_evidence_incomplete'}
 $report.status='read';$report.actualWordRead=$true;$report['wordVersion']=$wordVersion;$report['nodeVersion']=$nodeVersion
 $report['nativeSha256']=$hashes;$report['selection']=@{start=$rangeStart;end=$rangeEnd;storyType=$story};$report['observation']=$result
} catch {$report.status='failed';$report.error=Error-Code $_}
finally {
 if($null -ne $inputWriter){try{$inputWriter.Dispose()}catch{}}
 if($null -ne $child){try{if(!$child.HasExited){$child.Kill()};$child.Dispose()}catch{}}
 if($null -ne $port){try{[void]$port.GetType().GetMethod('Dispose').Invoke($port,[object[]]@())}catch{$report.status='failed';$report.actualWordRead=$false;$report.error='native_cleanup_failed'}}
 foreach($comValue in @($selectedDocument,$selectedRange,$selection,$window,$app)) {
  try{Release-Com $comValue}catch{$report.status='failed';$report.actualWordRead=$false;$report.error='native_cleanup_failed'}
 }
}
$json=$report|ConvertTo-Json -Depth 20
if($ReportPath) {
 # CreateNew prevents accidental replacement of an earlier evidence file.
 $stream=[IO.File]::Open([IO.Path]::GetFullPath($ReportPath),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=$utf8.GetBytes($json);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
}
Write-Output $json
if(!$report.actualWordRead){exit 1}
