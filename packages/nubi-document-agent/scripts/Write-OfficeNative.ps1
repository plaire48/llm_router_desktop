# Developer smoke writer: existing native DLLs, one already-open EMPTY test document.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('word','excel','powerpoint')][string]$App,
 [Parameter(Mandatory=$true)][string]$NativeDirectory,
 [Parameter(Mandatory=$true)][string]$NodePath,
 [Parameter(Mandatory=$true)][string]$ExpectedDocumentName,
 [Parameter(Mandatory=$true)][string]$ReportPath,
 [switch]$Save
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$utf8=[Text.UTF8Encoding]::new($false);$port=$null;$child=$null;$writer=$null;$application=$null;$window=$null;$reportStream=$null
$report=[ordered]@{schemaVersion=1;status='blocked';app=$App;actualNativeWrite=$false;savedToOffice=$false;office2016Verified=$false;nascaVerified=$false;nativeCalls=0;mutationDispatched=$false;writeResultUncertain=$false;error=$null}
function Code($Failure){$cause=$Failure.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException};if($cause.Message -cmatch '^[a-z][a-z0-9_]{1,80}$'){return $cause.Message};return 'native_write_failed'}
function Release-Com($Value){if($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value)}}
function Get-Step([string]$Target,[string]$Member,[string]$Id='',$ArgsList=@()){$s=@{target=$Target;action='get';member=$Member};if($Id){$s.id=$Id};if(@($ArgsList).Count){$s.args=@($ArgsList)};return $s}
function Set-Step([string]$Target,[string]$Member,$Value){return @{target=$Target;action='set';member=$Member;value=$Value}}
function Check($Read,$Equals){return @{read=$Read;equals=$Equals}}
try{
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'windows_required'}
 if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -lt 5){throw 'windows_powershell_5_required'}
 if([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA){throw 'sta_required'}
 # Reserve evidence before any mutation. Never overwrite an earlier report.
 $reportStream=[IO.File]::Open([IO.Path]::GetFullPath($ReportPath),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 $nativeRoot=(Resolve-Path -LiteralPath $NativeDirectory).Path;$node=(Resolve-Path -LiteralPath $NodePath).Path
 $version=(& $node --version|Out-String).Trim();if($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.(\d+)\.\d+$' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 19)){throw 'node_22_19_required'}
 $entry=Join-Path $PSScriptRoot 'write-office-native.mjs';$bundle=Join-Path (Split-Path $PSScriptRoot -Parent) 'dist/index.js';if(!(Test-Path -LiteralPath $bundle -PathType Leaf)){throw 'writer_build_required'}
 $hashes=[ordered]@{}
 foreach($name in @('Newtonsoft.Json.dll','OfficeX.Core.dll','OfficeX.ExcelHost.dll')){$file=Join-Path $nativeRoot $name;if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'native_dependency_missing'};$hashes[$name]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$assembly=[Reflection.Assembly]::LoadFrom($file);if($name -eq 'OfficeX.Core.dll'){$core=$assembly};if($name -eq 'OfficeX.ExcelHost.dll'){$hostAssembly=$assembly}}
 $dispatchGet=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeDispatch',$true).GetMethod('Get',[Reflection.BindingFlags]'Public,Static')
 function Native-Get($Object,[string]$Member){return ,$dispatchGet.Invoke($null,[object[]]@($Object,$Member,[object[]]@()))}
 $progId=@{word='Word.Application';excel='Excel.Application';powerpoint='PowerPoint.Application'}[$App];$application=[Runtime.InteropServices.Marshal]::GetActiveObject($progId)
 $windowType=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeWindow',$true);$window=$windowType.GetMethod('GetActiveWindow').Invoke($null,[object[]]@($application));$hwnd=$windowType.GetMethod('Handle').Invoke($null,[object[]]@($window,$App))
 $portType=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeAutomationPort',$true);$port=[Activator]::CreateInstance($portType,[Reflection.BindingFlags]'Instance,Public,NonPublic',$null,[object[]]@($application,$App,$hwnd),[Globalization.CultureInfo]::InvariantCulture)
 $document=$portType.GetProperty('BoundDocument').GetValue($port,$null);if((Native-Get $document 'Name') -cne $ExpectedDocumentName){throw 'expected_document_mismatch'}
 $docId=[string]$portType.GetProperty('DocumentId').GetValue($port,$null);$officeVersion=[string](Native-Get $application 'Version');if($officeVersion -notmatch '^16\.'){throw 'office_major_16_required'}
 $sessionType=$core.GetType('OfficeX.Core.OfficeAutomationSession',$true);$session=[Activator]::CreateInstance($sessionType,[object[]]@($port));$inspect=$sessionType.GetMethod('Inspect');$prepare=$sessionType.GetMethod('Prepare');$apply=$sessionType.GetMethod('Apply');$checkSource=$portType.GetMethod('CheckSource');$wireJson=$core.GetType('OfficeX.Core.Wire',$true).GetMethod('Json')
 $stepsType=[Type]::GetType('System.Collections.Generic.List`1').MakeGenericType([Type[]]@($core.GetType('OfficeX.Core.OfficeStep',$true)));$checksType=[Type]::GetType('System.Collections.Generic.List`1').MakeGenericType([Type[]]@($core.GetType('OfficeX.Core.OfficeCheck',$true)))
 function Json($Value){return $wireJson.Invoke($null,[object[]]@($Value))}
 function Steps($Value){return ,[Newtonsoft.Json.JsonConvert]::DeserializeObject((ConvertTo-Json -InputObject @($Value) -Compress -Depth 30),$stepsType)}
 function Native-Inspect($Value){return $inspect.Invoke($session,([object[]](,(Steps $Value))))}
 $text='Nubi native write probe';$after=@();$calculateTarget=$null
 if($App -eq 'word'){
  $observe=@((Get-Step document Content body),(Get-Step body Text),(Get-Step document ReadOnly),(Get-Step body 'Tables.Count'),(Get-Step body 'Fields.Count'),(Get-Step body 'InlineShapes.Count'),(Get-Step body 'ContentControls.Count'))
  $blank=Native-Inspect $observe;if($blank.Results[1] -cne "`r" -or $blank.Results[2] -ne $false -or @($blank.Results|Select-Object -Skip 3|Where-Object {$_ -ne 0}).Count -ne 0){throw 'empty_writable_test_document_required'}
  $writes=@((Set-Step body Text ($text+"`r")),(Get-Step body Font font),(Set-Step font Bold -1),(Get-Step body ParagraphFormat paragraph),(Set-Step paragraph SpaceAfter 6))
  $checks=@((Check (Get-Step body Text) ($text+"`r")),(Check (Get-Step font Bold) -1),(Check (Get-Step paragraph SpaceAfter) 6))
 }elseif($App -eq 'excel'){
  $observe=@((Get-Step document 'Worksheets.Count'),(Get-Step document ReadOnly),(Get-Step document 'Worksheets.Item' sheet @(1)),(Get-Step sheet 'UsedRange.CountLarge'),(Get-Step sheet 'UsedRange.Address'),(Get-Step sheet ProtectContents),(Get-Step sheet Range cells @('A1:C3')),(Get-Step cells Value2),(Get-Step cells Formula))
  $blank=Native-Inspect $observe;if($blank.Results[0] -ne 1 -or $blank.Results[1] -ne $false -or $blank.Results[3] -ne 1 -or $blank.Results[4] -cne '$A$1' -or $blank.Results[5] -ne $false){throw 'empty_writable_test_document_required'}
  foreach($matrix in @($blank.Results[7],$blank.Results[8])){foreach($row in $matrix){foreach($value in $row){if($null -ne $value -and [string]$value -ne ''){throw 'empty_writable_test_document_required'}}}}
  $writes=@((Get-Step sheet Range inputA @('A1')),(Set-Step inputA Value2 1),(Get-Step sheet Range inputB @('A2')),(Set-Step inputB Value2 2),(Get-Step sheet Range output @('B1')),(Set-Step output Formula '=SUM(A1:A2)'),(Get-Step output Font font),(Set-Step font Bold $true))
  $checks=@((Check (Get-Step inputA Value2) 1),(Check (Get-Step inputB Value2) 2),(Check (Get-Step output Formula) '=SUM(A1:A2)'),(Check (Get-Step font Bold) $true));$after=@((Check (Get-Step output Value2) 3));$calculateTarget='sheet'
 }else{
  $observe=@((Get-Step document 'Slides.Count'),(Get-Step document 'Slides' slides))
  $blank=Native-Inspect $observe;if($blank.Results[0] -ne 0){throw 'empty_test_presentation_required'}
  $writes=@(@{target='slides';action='call';member='Add';args=@(1,12);id='slide'},(Get-Step slide Shapes shapes),@{target='shapes';action='call';member='AddTextbox';args=@(1,40,60,640,80);id='box'},(Get-Step box TextFrame frame),(Get-Step frame TextRange text),(Set-Step text Text $text),(Get-Step text Font font),(Set-Step font Bold -1))
  $checks=@((Check (Get-Step document 'Slides.Count') 1),(Check (Get-Step text Text) $text),(Check (Get-Step font Bold) -1),(Check (Get-Step shapes Count) 1))
 }
 $request=@{summary='Write synthetic content and formatting in the empty test document';observe=$observe;steps=$writes;checks=$checks};if($after.Count){$request.afterChecks=$after};if($calculateTarget){$request.calculateTarget=$calculateTarget}
 $runId=[Guid]::NewGuid().ToString('N');$start=@{type='office_write_start';runId=$runId;connection=@{environment='windows-office';app=$App;scope=@{projectId='native-write-probe';taskId=$runId};documentId=$docId;officeSessionId=[Guid]::NewGuid().ToString('N')};request=$request}
 $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$node;$psi.Arguments='"'+$entry+'"';$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.StandardOutputEncoding=$utf8;$psi.EnvironmentVariables.Clear()
 foreach($name in @('SystemRoot','WINDIR','SystemDrive','TEMP','TMP','PATH')){$v=[Environment]::GetEnvironmentVariable($name);if($null -ne $v){$psi.EnvironmentVariables[$name]=$v}}
 $child=[Diagnostics.Process]::Start($psi);$discarded=$child.StandardError.ReadToEndAsync();$writer=[IO.StreamWriter]::new($child.StandardInput.BaseStream,$utf8);$writer.AutoFlush=$true;$writer.WriteLine(($start|ConvertTo-Json -Compress -Depth 30));$result=$null;$phase=0;$snapshotId=$null
 while($null -ne ($line=$child.StandardOutput.ReadLine())){
  if($line.Length -gt 300000){throw 'native_frame_invalid'};$message=$line|ConvertFrom-Json;if($message.runId -cne $runId){throw 'native_run_mismatch'}
  if($message.type -eq 'office_write_result'){$result=$message.result;break}
  if($message.type -ne 'tool' -or $message.id -notmatch '^[a-zA-Z0-9-]{1,160}$'){throw 'native_frame_invalid'}
  $response=$null
  try{
   [void]$checkSource.Invoke($port,[object[]]@());$report.nativeCalls++
   if($phase -eq 0 -and $message.name -ceq 'inspect_office'){
    $expected=@{steps=$observe};$actual=[Newtonsoft.Json.Linq.JToken]::Parse(($message.input|ConvertTo-Json -Compress -Depth 30));if(![Newtonsoft.Json.Linq.JToken]::DeepEquals($actual,[Newtonsoft.Json.Linq.JToken]::Parse(($expected|ConvertTo-Json -Compress -Depth 30)))){throw 'native_recipe_mismatch'}
    $response=Native-Inspect $observe
    if(![Newtonsoft.Json.Linq.JToken]::DeepEquals([Newtonsoft.Json.Linq.JToken]::Parse((Json $response.Results)),[Newtonsoft.Json.Linq.JToken]::Parse((Json $blank.Results)))){throw 'empty_test_source_changed'}
    $snapshotId=$response.SnapshotId;$phase=1
   }elseif($phase -eq 1 -and $message.name -ceq 'execute_office_operations'){
    $expected=@{snapshotId=$snapshotId;summary=$request.summary;steps=$writes;checks=$checks};if(![Newtonsoft.Json.Linq.JToken]::DeepEquals([Newtonsoft.Json.Linq.JToken]::Parse(($message.input|ConvertTo-Json -Compress -Depth 30)),[Newtonsoft.Json.Linq.JToken]::Parse(($expected|ConvertTo-Json -Compress -Depth 30)))){throw 'native_recipe_mismatch'}
    $nativeChecks=[Newtonsoft.Json.JsonConvert]::DeserializeObject((ConvertTo-Json -InputObject @($checks) -Compress -Depth 30),$checksType)
    $plan=$prepare.Invoke($session,[object[]]@($snapshotId,$request.summary,(Steps $writes),$nativeChecks));$report.mutationDispatched=$true;$report.writeResultUncertain=$true
    # Invoking this developer command authorizes only this fixed synthetic recipe.
    $response=$apply.Invoke($session,[object[]]@($plan.Id,$true,[Threading.CancellationToken]::None));$report.writeResultUncertain=[bool]$response.WriteResultUncertain;$phase=2
   }elseif($phase -eq 2 -and $App -eq 'excel' -and $message.name -ceq 'calculate_office'){
    if($message.input.target -cne 'sheet' -or @($message.input.PSObject.Properties).Count -ne 1){throw 'native_recipe_mismatch'}
    $response=$portType.GetMethod('Calculate').Invoke($port,[object[]]@('sheet',[Threading.CancellationToken]::None));$phase=3
   }elseif(($phase -eq 2 -and $App -ne 'excel' -or $phase -eq 3 -and $App -eq 'excel') -and $message.name -ceq 'inspect_office'){
    $allChecks=@($checks)+@($after);$reads=@($allChecks|ForEach-Object {$_.read});$expected=@{steps=$reads};if(![Newtonsoft.Json.Linq.JToken]::DeepEquals([Newtonsoft.Json.Linq.JToken]::Parse(($message.input|ConvertTo-Json -Compress -Depth 30)),[Newtonsoft.Json.Linq.JToken]::Parse(($expected|ConvertTo-Json -Compress -Depth 30)))){throw 'native_recipe_mismatch'}
    $response=Native-Inspect $reads;$phase=4
   }else{throw 'native_recipe_mismatch'}
  }catch{$response=@{ok=$false;error=(Code $_)}}
  $writer.WriteLine(('{"type":"tool_result","runId":"'+$runId+'","id":"'+$message.id+'","result":'+(Json $response)+'}'))
 }
 if($null -eq $result){throw 'native_connection_closed'}
 $report['observation']=$result;if($result.PSObject.Properties.Name -contains 'writeResultUncertain' -and $result.writeResultUncertain){$report.writeResultUncertain=$true}
 if(!$child.WaitForExit(5000)){throw 'writer_exit_unconfirmed'}
 if($child.ExitCode -ne 0 -or $result.status -cne 'verified_unsaved' -or $phase -ne 4){throw 'native_write_not_verified'}
 [void]$checkSource.Invoke($port,[object[]]@());$report.status='verified_unsaved';$report.actualNativeWrite=$true;$report.writeResultUncertain=$false;$report['observation']=$result;$report['officeVersion']=$officeVersion;$report['nodeVersion']=$version;$report['nativeSha256']=$hashes;$report['bundleSha256']=(Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
 if($Save){$saved=$portType.GetMethod('Save').Invoke($port,[object[]]@($false,[Threading.CancellationToken]::None));$saveObject=[Newtonsoft.Json.Linq.JObject]::Parse((Json $saved));$report.savedToOffice=($saveObject.saved -eq $true);$report['saveStatus']=[string]$saveObject.status;if($report.savedToOffice){$report.status='verified_saved'}}
}catch{$report.error=Code $_;$report.status=if($report.mutationDispatched){'needs_review'}else{'failed'}}
finally{
 if($null -ne $writer){try{$writer.Dispose()}catch{}};if($null -ne $child){try{if(!$child.HasExited){$child.Kill()};$child.Dispose()}catch{}}
 if($null -ne $port){try{[void]$port.GetType().GetMethod('Dispose').Invoke($port,[object[]]@())}catch{$report.status='needs_review';$report.actualNativeWrite=$false;$report.error='native_cleanup_failed'}}
 foreach($item in @($window,$application)){try{Release-Com $item}catch{$report.status='needs_review';$report.actualNativeWrite=$false;$report.error='native_cleanup_failed'}}
 $output=$report|ConvertTo-Json -Depth 20;if($null -ne $reportStream){try{$data=$utf8.GetBytes($output);$reportStream.Write($data,0,$data.Length)}finally{$reportStream.Dispose()}};Write-Output $output
}
if(!$report.actualNativeWrite -or $report.status -eq 'needs_review'){exit 1}
