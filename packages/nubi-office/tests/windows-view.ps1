param([string]$Helper = 'native/Nubi.Office.View/bin/Release/net472/Nubi.Office.View.exe')
$ErrorActionPreference = 'Stop'
Remove-Item verification/windows-view.json -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Nubi Office view fixture'
$form.Size = New-Object System.Drawing.Size(900,650)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Actual Office target fixture'
$button.Location = New-Object System.Drawing.Point(40,70)
$button.Size = New-Object System.Drawing.Size(330,90)
$button.BackColor = [System.Drawing.Color]::CornflowerBlue
$label = New-Object System.Windows.Forms.Label
$label.Text = '한글 보고서 0001'
$label.Location = New-Object System.Drawing.Point(40,30)
$label.AutoSize = $true
$privatePane = New-Object System.Windows.Forms.Panel
$privatePane.Location = New-Object System.Drawing.Point(580,0)
$privatePane.Size = New-Object System.Drawing.Size(300,600)
$privateLabel = New-Object System.Windows.Forms.Label
$privateLabel.Text = 'EXCLUDED_NUBI_CHAT'
$privateLabel.AutoSize = $true
$privatePane.Controls.Add($privateLabel)
$list = New-Object System.Windows.Forms.ListBox
$list.AccessibleName = 'Scrollable rows'
$list.Location = New-Object System.Drawing.Point(40,200)
$list.Size = New-Object System.Drawing.Size(330,150)
1..100 | ForEach-Object { [void]$list.Items.Add("Row $_") }
$form.Controls.AddRange(@($label,$button,$list,$privatePane))
$script:clicks = 0
$button.Add_Click({ $script:clicks++; $label.Text = "Actual clicks: $script:clicks" })
function Observe([int]$ProcessId, $Action = $null) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = (Resolve-Path $Helper).Path
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $requestData = @{window=$form.Handle.ToInt64();excludeWindow=$privatePane.Handle.ToInt64();processId=$ProcessId}
        if ($Action) { foreach ($key in $Action.Keys) { $requestData[$key] = $Action[$key] } }
        $request = $requestData | ConvertTo-Json -Compress -Depth 10
        # Exercise BOM-prefixed JSON from Windows text writers explicitly.
        $writer = New-Object System.IO.StreamWriter($process.StandardInput.BaseStream, (New-Object System.Text.UTF8Encoding($false)))
        $writer.WriteLine(([char]0xfeff).ToString() + $request); $writer.Close()
        $result = $process.StandardOutput.ReadToEndAsync()
        $deadline = [DateTime]::UtcNow.AddSeconds(12)
        while (!$process.HasExited -and [DateTime]::UtcNow -lt $deadline) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
        if (!$process.HasExited) { $process.Kill(); throw 'View helper exceeded deadline' }
        return ($result.Result | ConvertFrom-Json)
    } finally { $process.Dispose() }
}
try {
    $form.Show(); $form.Activate(); [System.Windows.Forms.Application]::DoEvents()
    $userPointerBefore = [System.Windows.Forms.Cursor]::Position
    $observed = Observe $PID
    if ($observed.error) { throw "View helper failed: $($observed.error), stage=$($observed.stage), type=$($observed.errorType), hresult=$($observed.hresult)" }
    if ($observed.imageStatus -ne 'captured' -or !$observed.image.StartsWith('iVBOR')) { throw 'Window screenshot missing' }
    $pixels = New-Object System.IO.MemoryStream(,[Convert]::FromBase64String($observed.image))
    $bitmap = [System.Drawing.Image]::FromStream($pixels)
    try {
        $masked = $bitmap.GetPixel([int]($bitmap.Width * 0.85), [int]($bitmap.Height * 0.4))
        if ($masked.R -ne 255 -or $masked.G -ne 255 -or $masked.B -ne 255) { throw 'Excluded pane pixels were not masked' }
    } finally { $bitmap.Dispose(); $pixels.Dispose() }
    if ('한글 보고서 0001'  -notin @($observed.elements | ForEach-Object { $_.name })) { throw 'Unicode UIA label missing' }
    if ('EXCLUDED_NUBI_CHAT' -in @($observed.elements | ForEach-Object { $_.name })) { throw 'Excluded pane was inspected' }
    $target = @($observed.elements | Where-Object { $_.name -eq 'Actual Office target fixture' })[0]
    if (!$target.runtimeId) { throw 'Observed UIA target identity missing' }
    $hover = Observe $PID @{action='hover';target=$target;observedAt=$observed.observedAt}
    if (!$hover.dispatched -or $hover.applicationVerified) { throw "Virtual marker validation failed: $($hover.error) stage=$($hover.stage) type=$($hover.errorType) hresult=$($hover.hresult)" }
    if ([System.Windows.Forms.Cursor]::Position -ne $userPointerBefore) { throw 'Virtual hover moved the user cursor' }
    $button.Left += 20
    [System.Windows.Forms.Application]::DoEvents()
    $stale = Observe $PID @{action='click';target=$target;observedAt=$observed.observedAt}
    if ($stale.error -ne 'view_target_changed' -or $stale.dispatched -or $script:clicks -ne 0) { throw 'Moved target was clicked' }
    $fresh = Observe $PID
    $target = @($fresh.elements | Where-Object { $_.name -eq 'Actual Office target fixture' })[0]
    $click = Observe $PID @{action='click';target=$target;observedAt=$fresh.observedAt}
    [System.Windows.Forms.Application]::DoEvents()
    if (!$click.dispatched -or $script:clicks -ne 1) { throw "UIA action was not received once: count=$script:clicks error=$($click.error)" }
    $after = Observe $PID
    if ('Actual clicks: 1' -notin @($after.elements | ForEach-Object { $_.name })) { throw 'Post-action UIA did not confirm actual effect' }
    $expired = Observe $PID @{action='click';target=$target;observedAt=1}
    if ($expired.error -ne 'view_action_invalid' -or $script:clicks -ne 1) { throw 'Expired target was clicked' }
    $unsupported = Observe $PID @{action='scroll_down';target=$target;observedAt=$after.observedAt}
    if ($unsupported.error -ne 'view_pattern_unsupported' -or $unsupported.dispatched) { throw 'Unsupported UIA pattern used an input fallback' }
    $scrollTarget = @($after.elements | Where-Object { $_.name -eq 'Scrollable rows' })[0]
    $topBefore = $list.TopIndex
    $wheel = Observe $PID @{action='scroll_down';target=$scrollTarget;observedAt=$after.observedAt}
    [System.Windows.Forms.Application]::DoEvents()
    if (!$wheel.dispatched -or $wheel.systemPointerUsed -or $list.TopIndex -le $topBefore) { throw "Semantic scroll failed: $($wheel.error)" }
    $invalid = Observe $PID @{action='type';target=$target;observedAt=$after.observedAt}
    if ($invalid.error -ne 'view_action_invalid' -or $invalid.dispatched) { throw 'Unsupported action was not rejected' }
    # Exercise the production native journal, not a test reimplementation.
    $hostPath = 'native/Nubi.Office.Host/bin/Release/net472/Nubi.Office.Host.dll'
    $helperFolder = Split-Path (Resolve-Path $Helper).Path
    $adjacentHost = Join-Path (Split-Path $helperFolder) 'Nubi.Office.Host.dll'
    if (Test-Path $adjacentHost) { $hostPath = $adjacentHost }
    if (Test-Path $hostPath) {
        $assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path $hostPath).Path)
        $viewType = $assembly.GetType('Nubi.Office.Host.OfficeView', $true)
        $journalRoot = Join-Path $env:TEMP ('nubi-view-journal-' + [Guid]::NewGuid().ToString('N'))
        New-Item (Join-Path $journalRoot 'View') -ItemType Directory -Force | Out-Null
        Copy-Item (Join-Path $helperFolder '*') (Join-Path $journalRoot 'View') -Recurse -Force
        $view = $viewType.GetConstructor([type[]]@([string])).Invoke([object[]]@([string](Join-Path $journalRoot 'NubiOffice')))
        $binding = [Newtonsoft.Json.Linq.JObject]::Parse('{"host":"excel","scopeId":"fixture","fingerprint":"fixture-stable"}')
        # A C# delegate may run on a continuation thread; PowerShell scriptblock
        # delegates require a Runspace and are not valid async test callbacks.
        Add-Type -ReferencedAssemblies @([Newtonsoft.Json.Linq.JObject].Assembly.Location,'System.Drawing') -TypeDefinition @'
using System;
using Newtonsoft.Json.Linq;
public static class NubiViewBinding {
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] private static extern int GetWindowText(IntPtr w, System.Text.StringBuilder text, int count);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] private static extern int GetClassName(IntPtr w, System.Text.StringBuilder text, int count);
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window,int index);
    [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window,uint command);
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")] public static extern int DwmFlush();
    public static string WindowPosition(IntPtr window) {Rect r;GetWindowRect(window,out r);return r.Left+","+r.Top;}
    public static string DescribeWindow(IntPtr window) {Rect r;GetWindowRect(window,out r);return "style="+GetWindowLong(window,-20).ToString("X")+" rect="+r.Left+","+r.Top+","+r.Right+","+r.Bottom+" previous="+GetWindow(window,3);}
    public static string DescribeForeground(){var w=GetForegroundWindow();var t=new System.Text.StringBuilder(200);var c=new System.Text.StringBuilder(100);GetWindowText(w,t,200);GetClassName(w,c,100);return c+" / "+t;}

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [System.Runtime.InteropServices.DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dest,int x,int y,int width,int height,IntPtr source,int sourceX,int sourceY,uint mode);
    public static void CapturePixels(System.Drawing.Bitmap bitmap,int x,int y) {
        var screen=GetDC(IntPtr.Zero);
        try { using(var graphics=System.Drawing.Graphics.FromImage(bitmap)) {
            var dest=graphics.GetHdc();
            try { if(!BitBlt(dest,0,0,bitmap.Width,bitmap.Height,screen,x,y,0x40cc0020))throw new InvalidOperationException("Layered capture failed"); }
            finally { graphics.ReleaseHdc(dest); }
        }} finally { ReleaseDC(IntPtr.Zero,screen); }
    }
    public static Func<bool> Motion(bool enabled) { return () => enabled; }
    public static Func<JObject> Capture(JObject value) { return () => value; }
}
'@
        $validate = [NubiViewBinding]::Capture($binding)
        function Await-View($Task) {
            $deadline = [DateTime]::UtcNow.AddSeconds(25)
            while (!$Task.IsCompleted -and [DateTime]::UtcNow -lt $deadline) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
            if (!$Task.IsCompleted) { throw 'Native view journal timed out' }
            return ,($Task.GetAwaiter().GetResult())
        }
        $nativeView = Await-View ($viewType.GetMethod('Observe').Invoke($view, [object[]]@($form.Handle,$privatePane.Handle,$binding,$validate)))
        $nativeTarget = @($nativeView.elements | Where-Object { $_.name.ToString() -eq 'Actual Office target fixture' })[0]
        $payload = [Newtonsoft.Json.Linq.JObject]::Parse((@{viewId=$nativeView.id.ToString();targetId=$nativeTarget.id.ToString();operationId=[Guid]::NewGuid().ToString();action='click';approved=$true} | ConvertTo-Json -Compress))
        $invokeArgs = [object[]]@($form.Handle,$privatePane.Handle,$binding,$payload,$validate)
        $receipt = Await-View ($viewType.GetMethod('Act').Invoke($view, $invokeArgs))
        if ($receipt.outcome.ToString() -ne 'dispatched' -or $script:clicks -ne 2) { throw "Native action failed: $receipt clicks=$script:clicks foreground=$([NubiViewBinding]::GetForegroundWindow()) expected=$($form.Handle) foregroundInfo=$([NubiViewBinding]::DescribeForeground()) marker=$($viewType.GetField('cursor',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($view).Handle)" }
        $again = Await-View ($viewType.GetMethod('Act').Invoke($view, $invokeArgs))
        if ($again.outcome.ToString() -ne 'dispatched' -or $script:clicks -ne 2) { throw 'Native receipt replay clicked twice' }
        $payload['operationId'] = [Newtonsoft.Json.Linq.JValue]::new([Guid]::NewGuid().ToString())
        try {
            $null = Await-View ($viewType.GetMethod('Act').Invoke($view, $invokeArgs))
            throw 'Consumed observation unexpectedly accepted'
        } catch {
            if ($_.Exception.GetBaseException().Code -ne 'view_expired') { throw }
        }
        $marker = $viewType.GetField('cursor',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($view)
        if (!$marker.MarkerVisible -or $marker.Focused -or $form.ActiveControl -eq $marker) { throw 'AI cursor overlay missing or stole focus' }
        $overlayStyle = $marker.GetType().GetProperty('CreateParams',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($marker).ExStyle
        if (($overlayStyle -band 0x08000000) -eq 0 -or ($overlayStyle -band 0x20) -eq 0) { throw 'AI cursor overlay is not no-activate and click-through' }
        if ([System.Windows.Forms.Cursor]::Position -ne $userPointerBefore) { throw 'Semantic actions moved the user cursor' }
        # Capture this synthetic fixture only, including the separate AI marker.
        $screenShot = New-Object System.Drawing.Bitmap($form.Width,$form.Height)
        try {
            # .NET Framework rejects combined CopyPixelOperation enum values.
            [System.Windows.Forms.Application]::DoEvents()
            [void][NubiViewBinding]::DwmFlush()
            [NubiViewBinding]::CapturePixels($screenShot,$form.Left,$form.Top)
            $screenShot.Save((Join-Path (Get-Location) 'verification/virtual-cursor.png'),[System.Drawing.Imaging.ImageFormat]::Png)
            # Native visibility is insufficient: require the actual branded marker pixels.
            $darkPixels = 0; $edgePixels = 0
            $markerX = $marker.Left - $form.Left
            $markerY = $marker.Top - $form.Top
            for ($y=$markerY;$y -lt $markerY+$marker.Height;$y++) {
                for ($x=$markerX;$x -lt $markerX+$marker.Width;$x++) {
                    $pixel = $screenShot.GetPixel($x,$y)
                    if ($pixel.R -eq 26 -and $pixel.G -eq 26 -and $pixel.B -eq 28) { $darkPixels++ }
                    if ($pixel.R -eq 255 -and $pixel.G -eq 255 -and $pixel.B -eq 255) { $edgePixels++ }
                }
            }
            if ($darkPixels -lt 80 -or $edgePixels -lt 20) { throw "Virtual cursor pixels missing: dark=$darkPixels edge=$edgePixels managed=$($marker.Bounds) native=$([NubiViewBinding]::DescribeWindow($marker.Handle)) form=$($form.Bounds) visible=$($marker.MarkerVisible) receipt=$receipt" }
        } finally { $screenShot.Dispose() }
        $viewType.GetMethod('Clear').Invoke($view, @()) | Out-Null
        if ($marker.MarkerVisible) { throw 'Cancelled marker remained visible' }
        $viewType.GetMethod('Dispose').Invoke($view, @()) | Out-Null
        # Test both preference branches with a local delegate, never alter Windows settings.
        $markerType = $marker.GetType()
        $constructor = $markerType.GetConstructor([Reflection.BindingFlags]'Instance,NonPublic',$null,[type[]]@([Func[bool]]),$null)
        foreach ($allowMotion in @($true,$false)) {
            $motionMarker = $constructor.Invoke([object[]]@([NubiViewBinding]::Motion($allowMotion)))
            try {
                if (!$motionMarker.Mark($form.Handle,$nativeTarget.bounds)) { throw 'First motion target unavailable' }
                if ($motionMarker.Moving) { throw 'First marker invented an unobserved origin' }
                $destination = [Newtonsoft.Json.Linq.JArray]::Parse(($scrollTarget.bounds | ConvertTo-Json -Compress))
                if (!$motionMarker.Mark($form.Handle,$destination)) { throw 'Second motion target unavailable' }
                if ($motionMarker.Moving -ne $allowMotion) { throw 'Motion preference not respected' }
                $positions = [System.Collections.Generic.HashSet[string]]::new()
                $arrivalTask = $motionMarker.WaitForArrival()
                $until = [DateTime]::UtcNow.AddSeconds(2)
                do {
                    [void]$positions.Add([NubiViewBinding]::WindowPosition($motionMarker.Handle))
                    [System.Windows.Forms.Application]::DoEvents()
                    Start-Sleep -Milliseconds 10
                } while (!$arrivalTask.IsCompleted -and [DateTime]::UtcNow -lt $until)
                [void]$positions.Add([NubiViewBinding]::WindowPosition($motionMarker.Handle))
                if (!$arrivalTask.IsCompleted -or !$arrivalTask.GetAwaiter().GetResult()) { throw 'AI cursor did not reach target' }
                if ($allowMotion -and $positions.Count -lt 3) { throw "Cursor movement frames missing: $($positions.Count)" }
                if (!$allowMotion -and $positions.Count -ne 1) { throw 'Reduced motion still moved the marker' }
                $motionMarker.IndicateClick()
                $pulse = $markerType.GetField('clickStarted',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($motionMarker)
                if (($pulse -ne 0) -ne $allowMotion) { throw 'Click indication ignored motion preference' }
                if ($allowMotion) {
                    # Cancel while moving, and ensure the waiter cannot trigger a later action.
                    [void]$motionMarker.Mark($form.Handle,$nativeTarget.bounds)
                    $cancelledArrival = $motionMarker.WaitForArrival()
                    $motionMarker.Dismiss()
                    if (!$cancelledArrival.IsCompleted -or $cancelledArrival.GetAwaiter().GetResult()) { throw 'Cancelled movement completed as arrived' }
                }
                if ([System.Windows.Forms.Cursor]::Position -ne $userPointerBefore) { throw 'AI animation moved user pointer' }
            } finally { $motionMarker.Dispose() }
        }
        Remove-Item $journalRoot -Recurse -Force
    } else { throw 'Native host assembly required for action journal checks' }
    $wrong = Observe ($PID + 100000)
    if ($wrong.error -ne 'view_window_unavailable') { throw 'Foreign process was not rejected' }
    @{nativeReceiptReplayPrevented=$true;consumedObservationRejected=$true;userCursorUnchanged=$true;virtualCursorVisible=$true;virtualCursorPixels=$true;virtualCursorMotion=$true;reducedMotion=$true;cancelledMotion=$true;virtualCursorClickThrough=$true;virtualCursorNoActivate=$true;semanticClickEffect=$true;semanticScrollEffect=$true;unsupportedPatternRejected=$true;movedTargetRejected=$true;expiredTargetRejected=$true;unsupportedInputRejected=$true;windowsUIAutomation=$true;windowCapture=$true;unicode=$true;excludedPane=$true;excludedPixels=$true;foreignProcessRejected=$true;officeCOM=$false;liveModel=$false} | ConvertTo-Json | Set-Content verification/windows-view.json -Encoding utf8
    Write-Host 'PASS: actual Windows UIA and memory screenshot on a WinForms fixture, UTF-8, pane exclusion and process binding. Not Office COM.'
} finally { $form.Close(); $form.Dispose() }
