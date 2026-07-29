$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $projectDir 'package.json') -Raw | ConvertFrom-Json
$sourceDir = Join-Path $projectDir 'release\win-unpacked'
$archivePath = Join-Path $projectDir "release\DataMatrix-Portable-$($manifest.version)-x64.zip"

if (-not (Test-Path (Join-Path $sourceDir 'DataMatrix.exe'))) {
  throw 'The unpacked DataMatrix application is missing. Run electron-builder before creating the portable ZIP.'
}

if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path (Join-Path $sourceDir '*') -DestinationPath $archivePath -CompressionLevel Fastest

if (-not (Test-Path $archivePath)) {
  throw 'The portable ZIP was not created.'
}

$sizeMb = [Math]::Round((Get-Item $archivePath).Length / 1MB, 1)
Write-Host "Created $archivePath ($sizeMb MB)"
