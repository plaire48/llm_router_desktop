param([Parameter(Mandatory=$true)][string]$InstallDirectory)
# Run with Windows PowerShell 5.1 in both process architectures, not PowerShell Core.
$ErrorActionPreference = 'Stop'
foreach ($application in @('Excel','Word','PowerPoint')) {
    $assembly = if ($application -eq 'Excel') { 'Nubi.Office.AddIn' } else { "Nubi.Office.$application.AddIn" }
    $addin = [Reflection.Assembly]::LoadFrom((Join-Path $InstallDirectory "$assembly.dll"))
    $entry = $addin.GetType("Nubi$application.ThisAddIn",$true)
    if ($entry.BaseType.FullName -ne 'Microsoft.Office.Tools.AddInBase') { throw 'Invalid VSTO entry point' }
    $ribbon = [Activator]::CreateInstance($addin.GetType("Nubi$application.NubiRibbon",$true))
    [xml]$xml = $ribbon.GetCustomUI("Microsoft.$application")
    if ($xml.customUI.ribbon.tabs.tab.id -ne 'nubiTab') { throw "$application ribbon is missing" }
}
$hostAssembly = [Reflection.Assembly]::LoadFrom((Join-Path $InstallDirectory 'Nubi.Office.Host.dll'))
$pane = $hostAssembly.GetType('Nubi.Office.Host.NubiPane',$true)
if ($pane.BaseType.FullName -ne 'System.Windows.Forms.UserControl') { throw 'Nubi pane is missing' }
$webview = [Reflection.Assembly]::LoadFrom((Join-Path $InstallDirectory 'Microsoft.Web.WebView2.Core.dll'))
$browser = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString($null)
if (!$browser) { throw 'WebView2 native loader or runtime is missing' }
& "$PSScriptRoot/worker-host.ps1" -HostAssemblyPath (Join-Path $InstallDirectory 'Nubi.Office.Host.dll') -BundleRoot (Join-Path $InstallDirectory 'NubiOffice')

Write-Host "PASS: VSTO types, ribbon, pane, WebView2 $browser and native worker with Windows system trust and TLS verification; process x$([IntPtr]::Size * 8). Office COM and company HTTPS not invoked."
