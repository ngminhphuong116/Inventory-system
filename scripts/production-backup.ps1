param([Parameter(Mandatory = $true)][string]$ProjectId)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$firebase = Join-Path $root 'node_modules\.bin\firebase.cmd'

if (-not (Test-Path -LiteralPath $firebase -PathType Leaf)) {
  throw 'Local Firebase CLI not found. Run npm install first.'
}

& $firebase login:list | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'Firebase CLI is not authenticated. Run: npx firebase login'
}

& $firebase use $projectId | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Cannot select Firebase project $projectId."
}

$backupDirectory = Join-Path $root 'backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDirectory "production-rtdb-$timestamp.json"
if (Test-Path -LiteralPath $backupPath) {
  throw "Refusing to overwrite existing backup: $backupPath"
}

& $firebase database:get / --project $projectId --output $backupPath
if ($LASTEXITCODE -ne 0) {
  throw 'Firebase database:get failed.'
}

$backup = Get-Item -LiteralPath $backupPath
if ($backup.Length -le 2) {
  throw "Backup is empty or invalid: $backupPath"
}
Get-Content -LiteralPath $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null

Write-Host "BACKUP_OK=$backupPath"
Write-Host "BACKUP_BYTES=$($backup.Length)"
Write-Host "Restore reference only (not executed): npx firebase database:set / `"$backupPath`" --project $projectId"
