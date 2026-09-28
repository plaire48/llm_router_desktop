param(
    [switch]$Publish,
    [string]$CertificateThumbprint,
    [string]$MSBuildPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'vendor\office-ai-agent\ExcelAi\ExcelAi.vbproj'
# This is a maintainer build, not an end-user installation procedure.
if (-not $MSBuildPath) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { throw 'Visual Studio with Office development tools is required.' }
    $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.OfficeTools -property installationPath
    if (-not $installation) { throw 'Install the Visual Studio Office/SharePoint development workload.' }
    $MSBuildPath = Join-Path $installation 'MSBuild\Current\Bin\MSBuild.exe'
}
if (-not (Test-Path $MSBuildPath)) { throw 'MSBuild was not found.' }
foreach ($file in @('dist\web\taskpane.html','dist\worker\main.mjs','dist\node_modules\@earendil-works\pi-agent-core\package.json','dist\runtime\x64\node.exe','dist\runtime\x86\node.exe')) {
    if (-not (Test-Path (Join-Path $root $file))) { throw "Missing packaged runtime: $file" }
}
if ($Publish) {
    if (-not $CertificateThumbprint -or $CertificateThumbprint -notmatch '^[0-9A-Fa-f]{40}$') { throw 'Provide an installed signing certificate thumbprint for publishing.' }
    $certificate = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint"
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'The publishing certificate is expired or has no private key.' }
}
Push-Location $root
try {
    & dotnet build native\Nubi.Office.Host\Nubi.Office.Host.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Native host build failed.' }
    & dotnet build native\Nubi.Office.EvalHost\Nubi.Office.EvalHost.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Excel evaluation host build failed.' }
    & $MSBuildPath $project /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=AnyCPU /nologo /v:minimal
    if ($LASTEXITCODE -ne 0) { throw 'VSTO dependency restore failed.' }
    $properties = @('/p:Configuration=Release', '/p:Platform=AnyCPU', '/p:ManifestKeyFile=', '/p:RegisterForComInterop=false', '/nologo', '/v:minimal')
    if ($Publish) {
        $properties += @('/t:Publish', '/p:SignManifests=true', "/p:ManifestCertificateThumbprint=$CertificateThumbprint")
    } else {
        $properties += @('/t:Build', '/p:SignManifests=false', '/p:GenerateManifests=false')
    }
    & $MSBuildPath $project @properties
    if ($LASTEXITCODE -ne 0) { throw 'VSTO build failed.' }
    Write-Host 'Build complete. Verify Excel 2016 x86/x64, WebView2, provider login and edit/readback/restore on Windows before release.'
} finally { Pop-Location }
