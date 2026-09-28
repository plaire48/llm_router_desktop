param([string]$TestAssemblyPath = 'native/Nubi.Office.SkillTests/bin/Release/net472/Nubi.Office.SkillTests.dll')
$ErrorActionPreference = 'Stop'
[void][Reflection.Assembly]::LoadFrom((Resolve-Path $TestAssemblyPath).Path)
$bits = [IntPtr]::Size * 8
[Nubi.Office.SkillTests.Program]::Run((Join-Path (Get-Location).Path "verification/windows-skills-x$bits.json"))
Write-Host "PASS: native ZIP/folder and protected skill catalog, x$bits. Office and picker UI are not exercised."
