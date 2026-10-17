param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
# Match the production Node UTF-8 read, including on Windows PowerShell 5.1.
$content = [IO.File]::ReadAllText($File, [Text.Encoding]::UTF8)
$ast = [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$tokens, [ref]$errors)
if ($errors.Count) {
  @{ok=$false;errors=@($errors | ForEach-Object { @{errorId=$_.ErrorId;line=$_.Extent.StartLineNumber} })} | ConvertTo-Json -Depth 5 -Compress
  exit 1
}
foreach ($name in @('Read-Failure','Cleanup-Failure')) {
  $functionAst = $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $false) | Where-Object Name -eq $name
  if (-not $functionAst) { throw 'diagnostic_function_missing' }
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
$request = @{app='word'}; $officeVersion = '16.0'
try { throw [System.Runtime.InteropServices.COMException]::new('PRIVATE_PATH_AND_BODY', -2147417846) }
catch { $first = Read-Failure $_ 'open' }
if ($first.error -ne 'document_office_read_failed' -or $first.diagnostic.hresult -ne '0x8001010A' -or $first.diagnostic.stage -ne 'open') { throw 'native_diagnostic_failed' }
try { throw [System.InvalidOperationException]::new('PRIVATE_CLOSE') }
catch { $kept = Cleanup-Failure $first $_ 'close'; $cleanupOnly = Cleanup-Failure @{document=@{text='PRIVATE_BODY'}} $_ 'close' }
if ($kept.error -ne 'document_office_read_failed' -or $kept.diagnostic.stage -ne 'open' -or -not $kept.diagnostic.cleanupFailed) { throw 'primary_failure_lost' }
if ($cleanupOnly.error -ne 'document_office_cleanup' -or $cleanupOnly.document) { throw 'cleanup_report_failed' }
# Execute the production segment-assembly expression, without launching Office.
$assignment = $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst]}, $false) | Where-Object { $_.Left.Extent.Text -eq '$text' -and $_.Right.Extent.Text -match '^\(\$segments' }
if (@($assignment).Count -ne 1) { throw 'segment_assignment_missing' }
$segments = @(@{sheet='예산';text='120000'},@{slide=2;text='두 번째'},@{text='본문'})
. ([scriptblock]::Create($assignment.Extent.Text))
if ($text -ne "시트: 예산`n120000`n`n슬라이드 2`n두 번째`n`n본문") { throw 'segment_assembly_failed' }
$json = @{ok=$true;platform=$PSVersionTable.Platform;version=[string]$PSVersionTable.PSVersion;scope='Parser and isolated reader functions; Office COM not executed';checks=@('syntax','hresult','primary_error','cleanup_error','segment_assembly');primary=$kept;cleanup=$cleanupOnly} | ConvertTo-Json -Depth 8 -Compress
if ($json -match 'PRIVATE') { throw 'private_data_leaked' }
[Console]::Out.Write($json)
