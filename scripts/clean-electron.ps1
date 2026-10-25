param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$rootPrefix = $root.TrimEnd('\') + '\'
$outputNames = @(
  'dist',
  'dist-electron',
  'release',
  'release-audit',
  'win-unpacked',
  'win-unpacked.tmp'
)

$activeProcesses = Get-CimInstance Win32_Process | Where-Object {
  $belongsToWorkspace = $_.CommandLine -and $_.CommandLine.Contains($root)
  $isAppProcess = $_.Name -match 'electron|QuanLyKhoHang'
  $isViteProcess = $_.CommandLine -and $_.CommandLine -match '[\\/]vite[\\/]'
  $belongsToWorkspace -and ($isAppProcess -or $isViteProcess)
}
if ($activeProcesses) {
  $details = ($activeProcesses | ForEach-Object {
    "PID $($_.ProcessId): $($_.Name)"
  }) -join ', '
  throw "Close Electron/Vite processes before cleaning: $details"
}

foreach ($name in $outputNames) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $root $name))
  if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output is outside workspace; refusing removal: $target"
  }
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Host "Removed $target"
  }
}
