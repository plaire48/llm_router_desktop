param([string]$BaselineInstallerPath = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$exe = (Resolve-Path "releases/Nubi-Office-$version-Setup.exe").Path
$installed = Join-Path $env:ProgramFiles 'Nubi Office'
$checks = [System.Collections.Generic.List[string]]::new()
$upgradeVerified = $false
$os = Get-CimInstance Win32_OperatingSystem
$userData = Join-Path $env:LOCALAPPDATA 'NubiOffice\installer-smoke-user-data.txt'
function Run-Setup([string]$File, [string]$Log, [string]$Components = "") {
    $componentArgs = @(); if ($Components) { $componentArgs += "/COMPONENTS=$Components" }
    Write-Host "Starting installer stage: $Log"
    $p = Start-Process $File -ArgumentList (@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$((Resolve-Path releases).Path)\$Log`"") + $componentArgs) -PassThru
    if (!$p.WaitForExit(360000)) { Stop-Process -Id $p.Id -Force; throw "Installer exceeded six minutes: $Log" }
    $p.Refresh()
    if ($p.ExitCode -notin @(0,3010)) { throw "Installer failed ($($p.ExitCode)); inspect $Log" }
}
function Assert-Components([string[]]$Selected) {
    foreach ($application in @('Excel','Word','PowerPoint')) {
        $component = $application.ToLowerInvariant()
        $assembly = if ($application -eq 'Excel') { 'Nubi.Office.AddIn' } else { "Nubi.Office.$application.AddIn" }
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
            $key = $base.OpenSubKey("Software\Microsoft\Office\$application\Addins\Nubi.Office")
            try {
                if ($component -notin $Selected) {
                    if ($key -or (Test-Path "$installed\$assembly.vsto")) { throw "Deselected $application add-in remains installed" }
                } else {
                    if (!$key -or $key.GetValue('LoadBehavior') -ne 3) { throw "$application registration missing in $view" }
                    $uri = [Uri]($key.GetValue('Manifest') -replace '\|vstolocal$','')
                    if ($uri.LocalPath -ne "$installed\$assembly.vsto" -or !(Test-Path $uri.LocalPath)) { throw "Invalid $application manifest" }
                }
            } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
        }
    }
}
if ($BaselineInstallerPath) {
    $baseline = (Resolve-Path $BaselineInstallerPath).Path
    if ((Get-FileHash $baseline -Algorithm SHA256).Hash -ne '8C75B87D7962C829B3AA027778ADA4F9E7079AE63F01941CD804ED7C6C70239A') { throw 'Baseline 0.8.3 installer hash mismatch' }
    Run-Setup $baseline 'baseline-0.8.3.log' 'core,excel,word,powerpoint'
    Assert-Components @('excel','word','powerpoint')
    $baselineVersion = (Get-Content "$installed\NubiOffice\package.json" -Raw | ConvertFrom-Json).version
    if ($baselineVersion -ne '0.8.3') { throw 'Baseline installation version mismatch' }
    New-Item (Split-Path $userData) -ItemType Directory -Force | Out-Null
    Set-Content $userData 'keep-user-data'
}
Run-Setup $exe 'install-word.log' 'core,word'
Assert-Components @('word')
if ($BaselineInstallerPath) {
    $installedVersion = (Get-Content "$installed\NubiOffice\package.json" -Raw | ConvertFrom-Json).version
    if ($installedVersion -ne $version -or !(Test-Path $userData) -or (Get-Content $userData -Raw).Trim() -ne 'keep-user-data') { throw 'Upgrade failed to preserve user data or update the installed version' }
    $upgradeVerified = $true
    $checks.Add("Published 0.8.3 upgrade to $version; selected components and user data preserved")
}
Run-Setup $exe 'change-powerpoint.log' 'core,powerpoint'
Assert-Components @('powerpoint')
Run-Setup $exe 'install-all.log' 'core,excel,word,powerpoint'
Assert-Components @('excel','word','powerpoint')
$checks.Add('Word-only, PowerPoint-only and all-app selection; deselected registrations and entry files removed in both registry views')
Write-Host "Verifying installed file hashes"
$stage = (Resolve-Path installer/stage).Path
$count = 0
foreach ($source in Get-ChildItem $stage -File -Recurse) {
    $relative = $source.FullName.Substring($stage.Length + 1)
    $dest = Join-Path $installed $relative
    if (!(Test-Path $dest) -or (Get-FileHash $source.FullName).Hash -ne (Get-FileHash $dest).Hash) { throw "Installed file mismatch: $relative" }
    $count++
}
$checks.Add("All $count installed files match SHA256")
foreach ($powershell in @("$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe", "$env:WINDIR\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")) {
    Write-Host "Verifying installed host: $powershell"
    $label = if ($powershell -like '*SysWOW64*') { 'x86' } else { 'x64' }
    $probe = Start-Process $powershell -ArgumentList @('-NoProfile','-STA','-File','tests/installed-host.ps1','-InstallDirectory',"`"$installed`"") -PassThru -RedirectStandardOutput "releases/host-$label.log" -RedirectStandardError "releases/host-$label-error.log"
    if (!$probe.WaitForExit(90000)) { Stop-Process -Id $probe.Id -Force; throw "Installed host exceeded 90 seconds: $label" }
    $probe.Refresh()
    Get-Content "releases/host-$label.log"
    if ($probe.ExitCode) { Get-Content "releases/host-$label-error.log"; throw "Installed host loading failed: $powershell" }
}
$checks.Add('Both x86 and x64 .NET Framework processes load VSTO entry, ribbon, pane and WebView2; native host launches worker with Windows system trust and removes inherited TLS bypass')
foreach ($arch in @('x64','x86')) {
    $env:NUBI_BUNDLE_ROOT = "$installed\NubiOffice"
    & "$installed\NubiOffice\runtime\$arch\node.exe" --use-system-ca tests/bundle-smoke.mjs
    if ($LASTEXITCODE) { throw "Installed $arch worker smoke failed" }
    $checks.Add("Installed $arch worker: five providers and UTF-8 RPC")
}
Remove-Item Env:\NUBI_BUNDLE_ROOT
Run-Setup $exe 'reinstall.log'
Assert-Components @('excel','word','powerpoint')
$checks.Add('Reinstallation completed')
foreach ($arch in @('x64','ia32')) {
    $uvVersion = & "$installed\NubiOffice\runtime\uv\$arch\uv.exe" --version
    if ($LASTEXITCODE -or $uvVersion -notmatch '^uv 0\.12\.18') { throw "Installed $arch uv failed" }
}
$checks.Add('Installed x64 and x86 uv executables report pinned version')
& "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -File tests/windows-view.ps1 -Helper "$installed\View\Nubi.Office.View.exe"
if ($LASTEXITCODE) { throw 'Installed Office view helper failed' }
$checks.Add('Installed window observer: actual UIA and screenshot on a bound WinForms fixture; excludes Nubi pane')
# User documents are outside the install directory and must survive removal.
if (!(Test-Path $userData)) {
    New-Item (Split-Path $userData) -ItemType Directory -Force | Out-Null
    Set-Content $userData 'keep-user-data'
}
Run-Setup "$installed\unins000.exe" 'uninstall.log'
Assert-Components @()
if (Test-Path "$installed\Nubi.Office.Host.dll") { throw 'Uninstall retained the native host' }
if (Test-Path "$installed\NubiOffice\package.json") { throw 'Uninstall retained the worker package' }
if (!(Test-Path $userData) -or (Get-Content $userData -Raw).Trim() -ne 'keep-user-data') { throw 'Uninstall removed or changed user data' }
$checks.Add('Uninstall removes application and all app registrations; retains user data')
Run-Setup $exe 'fresh-install.log' 'core,excel,word,powerpoint'
Assert-Components @('excel','word','powerpoint')
Run-Setup "$installed\unins000.exe" 'fresh-uninstall.log'
Assert-Components @()
if (Test-Path "$installed\Nubi.Office.Host.dll") { throw 'Uninstall retained the native host' }
if (Test-Path "$installed\NubiOffice\package.json") { throw 'Uninstall retained the worker package' }
if (!(Test-Path $userData) -or (Get-Content $userData -Raw).Trim() -ne 'keep-user-data') { throw 'Fresh install cycle changed user data' }
$checks.Add('Fresh application install after removal selects all apps; removal retains user data')
@{version=$version;windowsInstallerPassed=$true;upgradeFrom083Verified=$upgradeVerified;os=@{caption=$os.Caption;version=$os.Version;build=$os.BuildNumber;architecture=$os.OSArchitecture};windows11InstallerVerified=($os.Caption -match 'Windows 11');checks=$checks;excel2016Installed=$false;excel2016ExecutionVerified=$false;word2016ExecutionVerified=$false;powerpoint2016ExecutionVerified=$false;liveModelVerified=$false} | ConvertTo-Json -Depth 5 | Set-Content releases/installer-verification.json -Encoding utf8
