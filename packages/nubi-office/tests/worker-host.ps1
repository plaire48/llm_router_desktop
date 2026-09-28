param([Parameter(Mandatory=$true)][string]$HostAssemblyPath,[Parameter(Mandatory=$true)][string]$BundleRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
# Deliberately use a UI synchronization context without pumping messages.
# The pipe transport must complete independently of that context.
[System.Threading.SynchronizationContext]::SetSynchronizationContext((New-Object System.Windows.Forms.WindowsFormsSynchronizationContext))
$hostAssembly = [Reflection.Assembly]::LoadFrom((Resolve-Path $HostAssemblyPath).Path)
$workerType = $hostAssembly.GetType('Nubi.Office.Host.WorkerProcess',$true)
$priorTls = $env:NODE_TLS_REJECT_UNAUTHORIZED
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0' # The host must remove this inherited bypass.
$worker = $null
try {
    $constructor = $workerType.GetConstructor([type[]]@([string],[string]))
    if (!$constructor) { throw 'Native worker constructor is missing' }
    $worker = $constructor.Invoke([object[]]@([string]$BundleRoot,[string]'word'))
    $process = $workerType.GetField('process',[Reflection.BindingFlags]'Instance,NonPublic').GetValue($worker)
    if (!$process.StartInfo.Arguments.StartsWith('--use-system-ca ')) { throw 'Worker does not use Windows system trust' }
    if ($process.StartInfo.EnvironmentVariables['NODE_TLS_REJECT_UNAUTHORIZED'] -eq '0') { throw 'Worker inherited a TLS verification bypass' }
    $call = $workerType.GetMethod('Call').Invoke($worker,[object[]]@([string]'session',[Newtonsoft.Json.Linq.JObject]::new()))
    try { if (!$call.Wait(45000)) { throw 'Native worker session timed out' } }
    catch { $cause = $_.Exception.GetBaseException(); throw "Native worker call failed: $($cause.GetType().Name), code=$($cause.Code)" }
    $session = $call.Result.ToString() | ConvertFrom-Json
    $providerIds = @($session.providers | ForEach-Object { $_.id })
    if (($providerIds -join ',') -ne 'aipro,chatgpt,fabrix,aipro-cli,compatible') { throw 'Native worker provider catalog mismatch' }
    if ($session.host -ne 'word') { throw 'Native worker host binding mismatch' }
} finally {
    if ($worker) { $worker.Dispose() }
    $env:NODE_TLS_REJECT_UNAUTHORIZED = $priorTls
}
Write-Host "PASS: native worker session, UI-context independence, Windows trust and UTF-8 request; process x$([IntPtr]::Size * 8)."
