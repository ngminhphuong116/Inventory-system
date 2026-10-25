param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$backup = Get-Item -LiteralPath $resolvedBackup
if ($backup.Length -le 2) {
  throw "Backup is empty or invalid: $resolvedBackup"
}
Get-Content -LiteralPath $resolvedBackup -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null

$auditDirectory = Join-Path $root 'docs\audits'
New-Item -ItemType Directory -Path $auditDirectory -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $auditDirectory "PRODUCTION_DATA_AUDIT_$timestamp.md"
$jsonPath = [System.IO.Path]::ChangeExtension($reportPath, '.json')

$previousInput = $env:AUDIT_INPUT
$previousOutput = $env:AUDIT_OUTPUT
try {
  $env:AUDIT_INPUT = $resolvedBackup
  $env:AUDIT_OUTPUT = $reportPath
  npm --prefix functions run audit:data
  if ($LASTEXITCODE -ne 0) {
    throw 'Production audit failed.'
  }
} finally {
  $env:AUDIT_INPUT = $previousInput
  $env:AUDIT_OUTPUT = $previousOutput
}

$report = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "AUDIT_MD=$reportPath"
Write-Host "AUDIT_JSON=$jsonPath"
Write-Host "AUDIT_P0=$($report.counts.P0)"
if ([int]$report.counts.P0 -gt 0) {
  Write-Error 'P0 findings detected. Stop Database Rules deployment; do not mutate production data.'
  exit 2
}
