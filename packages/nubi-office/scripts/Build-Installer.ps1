param([string]$CertificateThumbprint)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$release = New-Item releases -ItemType Directory -Force
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -property installationPath
$targets = Join-Path $vs 'MSBuild\Microsoft\VisualStudio\v17.0\OfficeTools\Microsoft.VisualStudio.Tools.Office.targets'
if (!(Test-Path $targets)) {
    $setup = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
    $p = Start-Process $setup -ArgumentList @('modify', '--installPath', "`"$vs`"", '--add', 'Microsoft.VisualStudio.Workload.Office', '--includeRecommended', '--quiet', '--norestart') -Wait -PassThru
    if ($p.ExitCode -notin @(0,3010)) { throw "Office tools setup failed: $($p.ExitCode)" }
}
if (!(Test-Path $targets)) { throw 'VSTO build targets not installed' }
$msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
& dotnet build native/Nubi.Office.Host/Nubi.Office.Host.csproj -c Release
if ($LASTEXITCODE) { throw 'Native host build failed' }
& nuget install MicrosoftOfficeCore -Version 15.0.0 -OutputDirectory native/packages -NonInteractive
if ($LASTEXITCODE) { throw 'Office interop restore failed' }
$excel = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.office.interop.excel\15.0.4795.1001" -Filter Microsoft.Office.Interop.Excel.dll -Recurse | Select-Object -First 1 -ExpandProperty FullName
$office = Get-ChildItem native/packages/MicrosoftOfficeCore.15.0.0 -Filter Office.dll -Recurse | Select-Object -First 1 -ExpandProperty FullName
$word = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.office.interop.word\15.0.4797.1004" -Filter Microsoft.Office.Interop.Word.dll -Recurse | Select-Object -First 1 -ExpandProperty FullName
$powerpoint = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.office.interop.powerpoint\15.0.4420.1018" -Filter Microsoft.Office.Interop.PowerPoint.dll -Recurse | Select-Object -First 1 -ExpandProperty FullName
if (!$office -or !$excel -or !$word -or !$powerpoint) { throw 'Office interop assemblies were not restored' }
$preview = !$CertificateThumbprint
if ($preview) {
    # Manifest integrity only. Never install this certificate in a trust/root store.
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Nubi Office Preview' -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2)
    $CertificateThumbprint = $cert.Thumbprint
}
try {
    foreach ($name in @('Nubi.Office.AddIn','Nubi.Office.Word.AddIn','Nubi.Office.PowerPoint.AddIn')) {
        & $msbuild "native/$name/$name.vbproj" /t:Build /p:Configuration=Release "/p:ManifestCertificateThumbprint=$CertificateThumbprint" "/p:ExcelInteropPath=$excel" "/p:WordInteropPath=$word" "/p:PowerPointInteropPath=$powerpoint" "/p:OfficeCorePath=$office" /p:VisualStudioVersion=17.0 /nologo /v:minimal
        if ($LASTEXITCODE) { throw "VSTO add-in build failed: $name" }
    }
} finally {
    if ($preview) { Remove-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue }
}
& dotnet build native/Nubi.Office.View/Nubi.Office.View.csproj -c Release
if ($LASTEXITCODE) { throw 'Office view helper build failed' }
$stage = Join-Path $root 'installer/stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item $stage -ItemType Directory -Force | Out-Null
foreach ($name in @('Nubi.Office.AddIn','Nubi.Office.Word.AddIn','Nubi.Office.PowerPoint.AddIn')) {
    Copy-Item "native/$name/bin/Release/*" $stage -Recurse -Force
}
Copy-Item native/Nubi.Office.Host/bin/Release/net472/* $stage -Recurse -Force
New-Item "$stage/View" -ItemType Directory -Force | Out-Null
Copy-Item native/Nubi.Office.View/bin/Release/net472/* "$stage/View" -Recurse -Force
Copy-Item dist "$stage/NubiOffice" -Recurse
Copy-Item installer/INSTALL-KO.txt $stage
foreach ($required in @('View/Nubi.Office.View.exe','Nubi.Office.Word.AddIn.vsto','Nubi.Office.Word.AddIn.dll.manifest','Nubi.Office.PowerPoint.AddIn.vsto','Nubi.Office.PowerPoint.AddIn.dll.manifest','DocumentFormat.OpenXml.dll','DocumentFormat.OpenXml.Framework.dll','Nubi.Office.AddIn.vsto','Nubi.Office.AddIn.dll.manifest','Nubi.Office.Host.dll','NubiOffice/web/taskpane.html','NubiOffice/worker/main.mjs','NubiOffice/worker/script-thread.mjs','NubiOffice/worker/skills/excel-2016/references/calculations.md','NubiOffice/node_modules/quickjs-emscripten-core/dist/index.mjs','NubiOffice/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm','NubiOffice/runtime/uv/x64/uv.exe','NubiOffice/runtime/uv/ia32/uv.exe','NubiOffice/node_modules/proper-lockfile/index.js','NubiOffice/worker/skills/word-2016/scripts/report.py','NubiOffice/runtime/x64/node.exe','NubiOffice/runtime/x86/node.exe')) {
    if (!(Test-Path "$stage/$required")) { throw "Missing installer input: $required" }
}
$prereqs = New-Item installer/prerequisites -ItemType Directory -Force
$downloads = @(
    @{Name='vstor_redist.exe'; Url='https://download.microsoft.com/download/5/d/2/5d24f8f8-efbb-4b63-aa33-3785e3104713/vstor_redist.exe'},
    @{Name='MicrosoftEdgeWebview2Setup.exe'; Url='https://go.microsoft.com/fwlink/p/?LinkId=2124703'}
)
$inventory = @()
foreach ($item in $downloads) {
    $path = Join-Path $prereqs.FullName $item.Name
    Invoke-WebRequest $item.Url -OutFile $path
    $sig = Get-AuthenticodeSignature $path
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Untrusted prerequisite: $($item.Name)" }
    $inventory += @{name=$item.Name;source=$item.Url;sha256=(Get-FileHash $path -Algorithm SHA256).Hash;signer=$sig.SignerCertificate.Subject}
}
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
& $iscc "/DAppVersion=$version" installer/NubiOffice.iss *> releases/installer-compile.log
$compilerExit = $LASTEXITCODE
Get-Content releases/installer-compile.log -Tail 15
if ($compilerExit) { throw 'Installer compilation failed; inspect installer-compile.log' }
$exe = Get-Item "releases/Nubi-Office-$version-Setup.exe"
"$((Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower())  $($exe.Name)" | Set-Content "$($exe.FullName).sha256" -Encoding ascii
@{version=$version;commit=$env:GITHUB_SHA;runner=$env:RUNNER_OS;manifestSigning=$(if ($preview) {'self-signed preview'} else {'provided certificate'});installerAuthenticode='unsigned';prerequisites=$inventory;excel2016Verified=$false;word2016Verified=$false;powerpoint2016Verified=$false;components=@('excel','word','powerpoint');liveModelVerified=$false} | ConvertTo-Json -Depth 5 | Set-Content releases/installer-build.json -Encoding utf8
