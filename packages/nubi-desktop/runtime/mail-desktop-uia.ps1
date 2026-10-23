# Adapts the user-shared Knox cached UIA tree. This mail reader is read-only:
# no filesystem mail reads, Invoke, SelectionItem, clipboard or input calls.
$ErrorActionPreference = 'Stop'
try {
 Add-Type -AssemblyName UIAutomationClient
 Add-Type -AssemblyName UIAutomationTypes
 $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
 $profiles = @()
 $windows = @{}
 $root = [System.Windows.Automation.AutomationElement]::RootElement
 $top = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
 foreach ($window in $top) {
  try {
   $process = Get-Process -Id $window.Current.ProcessId
   if ($process.ProcessName -notin @('mySingleDesktopMessage', 'DesktopMessage', 'KnoxDesktop')) { continue }
   if ($window.Current.Name -match '(?i)메일\s*쓰기|새\s*메일|compose|write\s*mail') { continue }
   $binding = [ordered]@{ processId = $process.Id; hwnd = $window.Current.NativeWindowHandle; started = [string]$process.StartTime.ToUniversalTime().Ticks; processName = $process.ProcessName }
   $profiles += @{ label = $window.Current.Name; binding = $binding }
   $windows[[string]$window.Current.NativeWindowHandle] = $window
  } catch { continue }
 }
 if ($request.action -eq 'discover') { @{ supported = $true; profiles = @($profiles) } | ConvertTo-Json -Depth 6 -Compress; exit 0 }
 if ($request.action -ne 'snapshot') { throw 'mail_desktop_uia_unavailable' }
 $wanted = $request.binding
 $selected = @($profiles | Where-Object { $_.binding.processId -eq $wanted.processId -and $_.binding.hwnd -eq $wanted.hwnd -and $_.binding.started -ceq $wanted.started -and $_.binding.processName -ceq $wanted.processName })
 if ($selected.Count -ne 1) { throw 'mail_desktop_source_changed' }
 $window = $windows[[string]$wanted.hwnd]
 if ($window.Current.IsOffscreen) { throw 'mail_desktop_uia_body' }
 $cache = New-Object System.Windows.Automation.CacheRequest
 $cache.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
 $cache.TreeFilter = [System.Windows.Automation.Automation]::RawViewCondition
 foreach ($property in @([System.Windows.Automation.AutomationElement]::NameProperty, [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.AutomationElement]::AutomationIdProperty, [System.Windows.Automation.AutomationElement]::ClassNameProperty, [System.Windows.Automation.AutomationElement]::IsPasswordProperty, [System.Windows.Automation.AutomationElement]::IsOffscreenProperty)) {
  $cache.Add($property)
 }
 $tree = $window.GetUpdatedCache($cache)
 $queue = New-Object 'System.Collections.Generic.Queue[object]'
 $queue.Enqueue(@{ node = $tree; parent = $null })
 $nodes = New-Object 'System.Collections.Generic.List[object]'
 $verification = New-Object 'System.Collections.Generic.List[object]'
 while ($queue.Count -gt 0) {
  $item = $queue.Dequeue(); $node = $item.node; $current = $node.Cached
  if ($current.IsPassword -or $current.IsOffscreen) { continue }
  if ($nodes.Count -ge 2500) { throw 'mail_desktop_uia_limit' }
  $type = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
  $key = [string]$nodes.Count
  $record = @{ key = $key; parent = $item.parent; type = $type; name = $current.Name; automationId = $current.AutomationId; className = $current.ClassName }
  $valuePattern = $null
  if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
   $record.readOnly = $valuePattern.Current.IsReadOnly
   if ($record.readOnly) { $record.value = $valuePattern.Current.Value; $verification.Add(@{ valuePattern = $valuePattern; value = $record.value }) }
  }
  if ($type -eq 'Edit' -and $record.readOnly -ne $true) { continue }
  $textPattern = $null
  if ($type -eq 'Document' -and $record.readOnly -ne $false -and $node.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
   $record.text = $textPattern.DocumentRange.GetText(131073)
   if ($record.text.Length -gt 131072) { throw 'mail_desktop_uia_limit' }
   if ($record.text -cne $textPattern.DocumentRange.GetText(131073)) { throw 'mail_desktop_source_changed' }
   $verification.Add(@{ pattern = $textPattern; text = $record.text })
  }
  if ($type -eq 'Text') { $verification.Add(@{ node = $node; name = $current.Name }) }
  $nodes.Add($record)
  foreach ($child in $node.CachedChildren) { $queue.Enqueue(@{ node = $child; parent = $key }) }
 }
 foreach ($observed in $verification) {
  if ($observed.pattern -and $observed.text -cne $observed.pattern.DocumentRange.GetText(131073)) { throw 'mail_desktop_source_changed' }
  if ($observed.node -and $observed.name -cne $observed.node.Current.Name) { throw 'mail_desktop_source_changed' }
  if ($observed.valuePattern -and $observed.value -cne $observed.valuePattern.Current.Value) { throw 'mail_desktop_source_changed' }
 }
 # A different process at the same HWND or a changed window is not the source.
 $after = Get-Process -Id $wanted.processId
 if ([string]$after.StartTime.ToUniversalTime().Ticks -cne $wanted.started -or $window.Current.Name -cne $selected[0].label) { throw 'mail_desktop_source_changed' }
 @{ version = 1; binding = $selected[0].binding; capturedAt = [DateTime]::UtcNow.ToString('o'); nodes = @($nodes.ToArray()); truncated = $false } | ConvertTo-Json -Depth 8 -Compress
} catch {
 $code = [string]$_.Exception.Message
 if ($code -notmatch '^mail_desktop_[a-z_]+$') { $code = 'mail_desktop_uia_unavailable' }
 @{ error = $code } | ConvertTo-Json -Compress
 exit 1
}
