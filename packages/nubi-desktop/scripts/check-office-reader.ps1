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
foreach ($name in @('Read-Failure','Cleanup-Failure','Release-Com','Check-Text','Report-OfficeProgress','Read-ExcelSheet')) {
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
# Exercise the exact production extraction function with managed range objects.
# These objects model array bounds and formatting; they are not Office COM.
Add-Type -TypeDefinition @'
using System;
public class OfficeFixtureSheet {
 public string Name="PRIVATE_SHEET"; public object[,] Values; public string[,] Display;
 public bool Merged; public int TextCalls, Batches, LargestBatch, RowCounts, ColumnCounts;
 public OfficeFixtureSheet(int rows,int columns) { Values=new object[rows,columns];Display=new string[rows,columns]; }
 public OfficeFixtureRange UsedRange { get { return new OfficeFixtureRange(this,0,0,Values.GetLength(0),Values.GetLength(1)); } }
}
public class OfficeFixtureCount {
 OfficeFixtureSheet sheet; bool row; int count;
 public OfficeFixtureCount(OfficeFixtureSheet s,bool r,int c) {sheet=s;row=r;count=c;}
 public int Count {get {if(row)sheet.RowCounts++;else sheet.ColumnCounts++;return count;}}
}
public class OfficeFixtureRange {
 OfficeFixtureSheet sheet; int top,left,rows,columns;
 public OfficeFixtureRange(OfficeFixtureSheet s,int t,int l,int r,int c) {sheet=s;top=t;left=l;rows=r;columns=c;}
 public OfficeFixtureCount Rows {get {return new OfficeFixtureCount(sheet,true,rows);}}
 public OfficeFixtureCount Columns {get {return new OfficeFixtureCount(sheet,false,columns);}}
 public OfficeFixtureRange Cells {get {return this;}}
 public bool MergeCells {get {return sheet.Merged;}}
 public OfficeFixtureRange Item(int r,int c) {return new OfficeFixtureRange(sheet,top+r-1,left+c-1,1,1);}
 public OfficeFixtureRange Resize(int r,int c) {return new OfficeFixtureRange(sheet,top,left,r,c);}
 public string Text {get {sheet.TextCalls++;return sheet.Display[top,left]??"";}}
 public object Value2 {get {
  sheet.Batches++;sheet.LargestBatch=Math.Max(sheet.LargestBatch,rows*columns);
  if(rows==1&&columns==1)return sheet.Values[top,left];
  Array values=Array.CreateInstance(typeof(object),new int[]{rows,columns},new int[]{1,1});
  for(int r=0;r<rows;r++)for(int c=0;c<columns;c++)values.SetValue(sheet.Values[top+r,left+c],r+1,c+1);
  return values;
 }}
}
'@
$request = @{app='excel'}; $script:characters = 0
$sheet = New-Object OfficeFixtureSheet(100,300)
$sheet.Values[0,0]=46000; $sheet.Display[0,0]='2026-10-24'
$sheet.Values[0,1]=1200; $sheet.Display[0,1]='1,200원'
$sheet.Values[1,0]='00123'; $sheet.Display[1,0]='00123'
$sheet.Values[99,299]=''; $sheet.Display[99,299]='빈 수식 결과의 표시'
$capture = New-Object IO.StringWriter; $stderr = [Console]::Error
try {
 [Console]::SetError($capture)
 $result = Read-ExcelSheet $sheet 2 3
} finally { [Console]::SetError($stderr) }
if ($sheet.TextCalls -ne 4 -or $sheet.LargestBatch -gt 2048 -or $sheet.Batches -lt 2) { throw 'excel_batch_failed' }
if ($sheet.RowCounts -ne 1 -or $sheet.ColumnCounts -ne 1) { throw 'excel_counts_not_cached' }
$lines = $result.text -split "`n"
if ($lines.Count -ne 100 -or ($lines[0] -split "`t")[0] -ne '2026-10-24' -or ($lines[0] -split "`t")[1] -ne '1,200원' -or ($lines[1] -split "`t")[0] -ne '00123' -or ($lines[99] -split "`t")[-1] -ne '빈 수식 결과의 표시') { throw 'excel_display_changed' }
$frames = @($capture.ToString().Trim() -split "`n" | ForEach-Object { $_.Substring(21) | ConvertFrom-Json })
if ($frames[-1].completed -ne 30000 -or $frames[-1].total -ne 30000 -or $frames[-1].sheetIndex -ne 2 -or $capture.ToString() -match 'PRIVATE|00123|2026-10-24') { throw 'excel_progress_failed' }
foreach ($size in @(@(3000,1),@(1,2050),@(1,1))) {
 $script:characters=0; $shape=New-Object OfficeFixtureSheet($size[0],$size[1]); $shape.Values[0,0]=1; $shape.Display[0,0]='1'
 try { [Console]::SetError($capture); $null=Read-ExcelSheet $shape 1 1 } finally { [Console]::SetError($stderr) }
 if ($shape.TextCalls -ne 1 -or $shape.LargestBatch -gt 2048) { throw 'excel_array_shape_failed' }
}
$script:characters=0; $merged=New-Object OfficeFixtureSheet(1,2); $merged.Merged=$true
try { [Console]::SetError($capture); $null=Read-ExcelSheet $merged 1 1 } finally { [Console]::SetError($stderr) }
if ($merged.TextCalls -ne 2) { throw 'excel_merged_display_not_read' }
$checks = @('syntax','hresult','primary_error','cleanup_error','segment_assembly','excel_batches','excel_display','excel_array_shapes','excel_progress')
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
 $dictionary = New-Object -ComObject Scripting.Dictionary
 $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($dictionary)
 try { $alias = [Runtime.InteropServices.Marshal]::GetObjectForIUnknown($pointer) } finally { [void][Runtime.InteropServices.Marshal]::Release($pointer) }
 Release-Com $dictionary
 try { $alias.Add('fixture','retained'); if ($alias.Item('fixture') -ne 'retained') { throw 'com_alias_invalidated' } } finally { Release-Com $alias }
 $checks += 'com_reference_lifetime'
}
$json = @{ok=$true;platform=$PSVersionTable.Platform;version=[string]$PSVersionTable.PSVersion;scope='Parser and isolated reader functions; Office COM not executed';checks=$checks;primary=$kept;cleanup=$cleanupOnly} | ConvertTo-Json -Depth 8 -Compress
if ($json -match 'PRIVATE') { throw 'private_data_leaked' }
[Console]::Out.Write($json)
