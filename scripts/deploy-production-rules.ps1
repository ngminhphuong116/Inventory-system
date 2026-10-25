param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [Parameter(Mandatory = $true)]
  [string]$AuditJsonPath,
  [Parameter(Mandatory = $true)]
  [string]$CompatibilityJsonPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$firebase = Join-Path $root 'node_modules\.bin\firebase.cmd'
$backup = Get-Item -LiteralPath (Resolve-Path -LiteralPath $BackupPath).Path
if ($backup.Length -le 2) { throw 'Production backup is invalid.' }
Get-Content -LiteralPath $backup.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null

$auditPath = (Resolve-Path -LiteralPath $AuditJsonPath).Path
$audit = Get-Content -LiteralPath $auditPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($audit.readOnly -ne $true) { throw 'Audit report is not marked readOnly.' }
if ([int]$audit.counts.P0 -gt 0) {
  throw "Audit has $($audit.counts.P0) P0 findings. Database Rules deployment is blocked."
}
if ([int]$audit.counts.P1 -gt 0) {
  throw "Audit has $($audit.counts.P1) P1 findings. Database Rules deployment is blocked."
}

$compatibilityPath = (Resolve-Path -LiteralPath $CompatibilityJsonPath).Path
$compatibility = Get-Content -LiteralPath $compatibilityPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($compatibility.tenantSchemaReady -ne $true) {
  throw 'Tenant schema compatibility is not approved. Database Rules deployment is blocked.'
}
if ($compatibility.projectId -ne $projectId) {
  throw 'Compatibility report belongs to a different Firebase project.'
}

& $firebase login:list | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Firebase CLI is not authenticated.' }
& $firebase use $projectId | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Cannot select Firebase project $projectId." }

npm run test:rules
if ($LASTEXITCODE -ne 0) { throw 'Security Rules emulator tests failed.' }
& $firebase deploy --project $projectId --only database
if ($LASTEXITCODE -ne 0) { throw 'Database Rules deployment failed.' }
