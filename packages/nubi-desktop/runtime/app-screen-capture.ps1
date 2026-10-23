$ErrorActionPreference = 'Stop'
try {
 if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'app_capture_windows' }
 Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NubiScreenRead {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
}
'@
 $null = [NubiScreenRead]::SetThreadDpiAwarenessContext([IntPtr](-4))
 $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
 function Rect($r) { return [ordered]@{ x = $r.X; y = $r.Y; width = $r.Width; height = $r.Height } }
 function WindowRecord($w) {
  $c = $w.Current; [uint32]$ownerId = 0
  if ([NubiScreenRead]::GetWindowThreadProcessId([IntPtr]$c.NativeWindowHandle, [ref]$ownerId) -eq 0) { throw 'app_capture_changed' }
  $p = Get-Process -Id $ownerId
  if ($request.excludedProcessIds -contains $p.Id) { throw 'app_capture_protected' }
  if ($p.SessionId -ne (Get-Process -Id $PID).SessionId -or $c.IsOffscreen -or [NubiScreenRead]::IsIconic([IntPtr]$c.NativeWindowHandle)) { throw 'app_capture_changed' }
  $r = New-Object NubiScreenRead+Rect
  if (-not [NubiScreenRead]::GetWindowRect([IntPtr]$c.NativeWindowHandle, [ref]$r)) { throw 'app_capture_changed' }
  $width = $r.Right - $r.Left; $height = $r.Bottom - $r.Top
  if ($width -le 0 -or $height -le 0 -or [double]$width * $height -gt 20000000 -or $c.Name.Length -gt 500) { throw 'app_capture_limit' }
  return [ordered]@{ hwnd = $c.NativeWindowHandle; processId = $p.Id; started = [string]$p.StartTime.ToUniversalTime().Ticks; title = $c.Name; processName = $p.ProcessName; bounds = [ordered]@{ x = $r.Left; y = $r.Top; width = $width; height = $height } }
 }
 function Equal($a, $b) {
  if ($null -eq $a -or $null -eq $b) { return $false }
  foreach ($key in @('hwnd', 'processId', 'started', 'title', 'processName', 'runtimeId', 'name', 'type', 'automationId', 'password')) { if ([string]$a.$key -cne [string]$b.$key) { return $false } }
  foreach ($key in @('x', 'y', 'width', 'height')) { if ($a.bounds.$key -ne $b.bounds.$key) { return $false } }
  return $true
 }
 if ($request.action -eq 'discover') {
  if (-not $request.query -or $request.query.Length -gt 200) { throw 'app_capture_invalid' }
  $found = New-Object 'System.Collections.Generic.List[object]'; $partial = $false
  $top = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $top) {
   try { $record = WindowRecord $w } catch { continue }
   if (($record.title + ' ' + $record.processName).IndexOf($request.query, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
   if ($found.Count -ge 10) { $partial = $true; break }; $found.Add($record)
  }
  @{ windows = @($found.ToArray()); partial = $partial } | ConvertTo-Json -Depth 8 -Compress; exit 0
 }
 if ($request.action -notin @('inspect', 'capture')) { throw 'app_capture_invalid' }
 $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$request.window.hwnd)
 $before = WindowRecord $window
 if (-not (Equal $before $request.window)) { throw 'app_capture_changed' }
 function ReadTree($window, $request) {
 $queue = New-Object 'System.Collections.Generic.Queue[object]'; $queue.Enqueue($window)
 $elements = New-Object 'System.Collections.Generic.List[object]'; $passwords = New-Object 'System.Collections.Generic.List[object]'
 $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker; $visited = 0; $partial = $false; $target = $null
 while ($queue.Count -gt 0) {
  $node = $queue.Dequeue(); $visited++
  if ($visited -gt 2500) { throw 'app_capture_limit' }
  $c = $node.Current
  if ($c.IsOffscreen) { continue }
  if ($c.IsPassword) { $passwords.Add(@{ runtimeId = ($node.GetRuntimeId() -join ','); bounds = (Rect $c.BoundingRectangle) }); continue }
  $r = $c.BoundingRectangle
  if ($r.Width -gt 0 -and $r.Height -gt 0) {
   $record = [ordered]@{ runtimeId = ($node.GetRuntimeId() -join ','); name = $c.Name; type = $c.ControlType.ProgrammaticName.Replace('ControlType.', ''); automationId = $c.AutomationId; bounds = (Rect $r); password = $false }
   if ($record.name.Length -le 500) {
    if ($request.element -and $record.runtimeId -ceq $request.element.runtimeId) { if (-not (Equal $record $request.element)) { throw 'app_capture_changed' }; $target = $node }
    if ($request.query -and ($record.name + ' ' + $record.automationId).IndexOf($request.query, [StringComparison]::OrdinalIgnoreCase) -ge 0) { if ($elements.Count -lt 20) { $elements.Add($record) } else { $partial = $true } }
   }
  }
  $child = $walker.GetFirstChild($node)
  while ($null -ne $child) { $queue.Enqueue($child); if ($queue.Count + $visited -gt 2500) { throw 'app_capture_limit' }; $child = $walker.GetNextSibling($child) }
 }
 return @{ elements = $elements; passwords = $passwords; target = $target; partial = $partial }
 }
 $tree = ReadTree $window $request; $elements = $tree.elements; $passwords = $tree.passwords; $target = $tree.target; $partial = $tree.partial
 if (-not (Equal (WindowRecord $window) $before)) { throw 'app_capture_changed' }
 if ($request.action -eq 'inspect') { @{ window = $before; elements = @($elements.ToArray()); partial = $partial } | ConvertTo-Json -Depth 8 -Compress; exit 0 }
 if ($request.element -and $null -eq $target) { throw 'app_capture_changed' }
 if ($request.maxWidth -lt 128 -or $request.maxWidth -gt 2400) { throw 'app_capture_invalid' }
 $b = $before.bounds
 $crop = New-Object System.Drawing.Rectangle(0, 0, $b.width, $b.height)
 if ($target) {
  $r = $target.Current.BoundingRectangle
  $crop = [System.Drawing.Rectangle]::Intersect($crop, (New-Object System.Drawing.Rectangle([Math]::Floor($r.X - $b.x), [Math]::Floor($r.Y - $b.y), [Math]::Ceiling($r.Width), [Math]::Ceiling($r.Height))))
  if ($crop.Width -le 0 -or $crop.Height -le 0) { throw 'app_capture_changed' }
 }
 $bitmap = $null; $graphics = $null; $output = $null; $g = $null; $stream = $null
 try {
  $bitmap = [System.Drawing.Bitmap]::new($b.width, $b.height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.Clear([System.Drawing.Color]::Black)
  $dc = $graphics.GetHdc()
  try { if (-not [NubiScreenRead]::PrintWindow([IntPtr]$before.hwnd, $dc, 0)) { throw 'app_capture_unavailable' } } finally { $graphics.ReleaseHdc($dc) }
  $afterTree = ReadTree $window $request
  if ($afterTree.passwords.Count -ne $passwords.Count) { throw 'app_capture_changed' }
  for ($i = 0; $i -lt $passwords.Count; $i++) { if (-not (Equal $passwords[$i] $afterTree.passwords[$i])) { throw 'app_capture_changed' } }
  foreach ($password in $passwords) { $r = $password.bounds; $graphics.FillRectangle([System.Drawing.Brushes]::Black, [single]($r.x - $b.x), [single]($r.y - $b.y), [single]$r.width, [single]$r.height) }
  if (-not (Equal (WindowRecord $window) $before)) { throw 'app_capture_changed' }
  if ($target) {
   $c = $target.Current
   $after = [ordered]@{ runtimeId = ($target.GetRuntimeId() -join ','); name = $c.Name; type = $c.ControlType.ProgrammaticName.Replace('ControlType.', ''); automationId = $c.AutomationId; bounds = (Rect $c.BoundingRectangle); password = $c.IsPassword }
   if (-not (Equal $after $request.element) -or $c.IsOffscreen) { throw 'app_capture_changed' }
  }
  $scale = [Math]::Min(1, [double]$request.maxWidth / $crop.Width)
  $width = [Math]::Max(1, [int][Math]::Round($crop.Width * $scale)); $height = [Math]::Max(1, [int][Math]::Round($crop.Height * $scale))
  if ([double]$width * $height -gt 8000000) { throw 'app_capture_limit' }
  $output = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb); $g = [System.Drawing.Graphics]::FromImage($output)
  $g.DrawImage($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $width, $height)), $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $first = $output.GetPixel(0, 0).ToArgb(); $different = $false
  for ($y = 0; $y -lt $height; $y += [Math]::Max(1, [int]($height / 32))) { for ($x = 0; $x -lt $width; $x += [Math]::Max(1, [int]($width / 32))) { if ($output.GetPixel($x, $y).ToArgb() -ne $first) { $different = $true; break } }; if ($different) { break } }
  if (-not $different) { throw 'app_capture_blank' }
  $stream = New-Object System.IO.MemoryStream; $output.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  @{ window = $before; element = $request.element; image = [Convert]::ToBase64String($stream.ToArray()); width = $width; height = $height; passwordsMasked = ($passwords.Count -gt 0) } | ConvertTo-Json -Depth 8 -Compress
 } finally { if ($stream) { $stream.Dispose() }; if ($g) { $g.Dispose() }; if ($output) { $output.Dispose() }; if ($graphics) { $graphics.Dispose() }; if ($bitmap) { $bitmap.Dispose() } }
} catch {
 $code = [string]$_.Exception.Message
 if ($code -notmatch '^app_capture_[a-z_]+$') { $code = 'app_capture_unavailable' }
 @{ error = $code } | ConvertTo-Json -Compress; exit 1
}
