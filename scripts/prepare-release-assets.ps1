param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(-[\w.-]+)?$') { throw 'Invalid release version' }
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $root "release\$version"))
if (-not $releaseRoot.StartsWith($root + '\release\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid output path' }
Push-Location $root
try {
  node scripts/export-source.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Source export failed' }
  $assets = Join-Path $releaseRoot 'assets'
  New-Item -ItemType Directory -Path $assets -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $releaseRoot "installers\QuanLyKhoHang-$version-windows-x64-setup.exe") -Destination $assets
  foreach ($file in @('docs\INSTALLATION.md','docs\RELEASE_VALIDATION.md','docs\GITHUB_PUBLICATION.md','FIREBASE_DEPLOYMENT.md','RELEASE_NOTES.md')) {
    $text = [IO.File]::ReadAllText((Join-Path $root $file))
    # The downloadable documents sit beside one another rather than under docs/.
    $text = $text.Replace('(../FIREBASE_DEPLOYMENT.md)', '(FIREBASE_DEPLOYMENT.md)').Replace('(docs/RELEASE_VALIDATION.md)', '(RELEASE_VALIDATION.md)')
    [IO.File]::WriteAllText((Join-Path $assets (Split-Path -Leaf $file)), $text, [Text.UTF8Encoding]::new($false))
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Path]::GetFullPath((Join-Path $assets "inventory-system-$version-source.zip"))
  if (-not $zip.StartsWith($assets + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source archive path' }
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $releaseRoot 'github-source'), $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
  node scripts/release-checksums.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Checksum generation failed' }
  Get-ChildItem -LiteralPath $assets | Select-Object Name,Length
} finally { Pop-Location }
