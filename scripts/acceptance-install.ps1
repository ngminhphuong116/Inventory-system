param([switch]$Reinstall, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$testRoot = [IO.Path]::GetFullPath((Join-Path $root 'tmp\Kiểm thử phát hành'))
$installDir = Join-Path $testRoot 'Ứng dụng quản lý kho'
$expectedUninstaller = Join-Path $installDir 'Uninstall QuanLyKhoHangReleaseQA.exe'
if (-not $testRoot.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path outside workspace' }
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $root "release\$version\qa-installers\QuanLyKhoHang-$version-windows-x64-setup.exe"
$registrations = @(Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall,HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall,HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like 'QuanLyKhoHang Release QA*' })
foreach ($registration in $registrations) {
  if (-not $registration.UninstallString.StartsWith('"' + $expectedUninstaller + '"')) { throw 'Existing QA installation outside test root; refusing to change it' }
}
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'QuanLyKhoHang Release QA.lnk'
$menuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'QuanLyKhoHang Release QA.lnk'
if (-not ($Reinstall -or $Uninstall) -and ((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menuLink))) { throw 'Existing shortcut detected; refusing to replace it' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$timer = [Diagnostics.Stopwatch]::StartNew()
if ($Uninstall) {
  $uninstaller = $expectedUninstaller
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Test uninstaller missing' }
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
  $process.WaitForExit()
  # NSIS may continue cleanup in its temporary child process.
  for ($i = 0; $i -lt 200; $i++) {
    $executableRemains = Test-Path -LiteralPath (Join-Path $installDir 'QuanLyKhoHangReleaseQA.exe')
    if (-not $executableRemains -and -not (Test-Path -LiteralPath $desktopLink) -and -not (Test-Path -LiteralPath $menuLink)) { break }
    Start-Sleep -Milliseconds 100
  }
  if (Test-Path -LiteralPath (Join-Path $installDir 'QuanLyKhoHangReleaseQA.exe')) { throw 'Executable remains after uninstall' }
  if ((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menuLink)) { throw 'Test shortcuts remain after uninstall' }
  Write-Output "UNINSTALL_OK seconds=$($timer.Elapsed.TotalSeconds)"
  exit
}
$process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru -WindowStyle Hidden
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
if (-not (Test-Path -LiteralPath (Join-Path $installDir 'QuanLyKhoHangReleaseQA.exe'))) { throw 'Installed executable missing' }
$shell = New-Object -ComObject WScript.Shell
foreach ($link in @($desktopLink, $menuLink)) {
  if (-not (Test-Path -LiteralPath $link)) { throw "Missing shortcut: $link" }
  if ($shell.CreateShortcut($link).TargetPath -ne (Join-Path $installDir 'QuanLyKhoHangReleaseQA.exe')) { throw 'Incorrect shortcut target' }
}
$registration = @(Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object { $_.DisplayName -like 'QuanLyKhoHang Release QA*' -and $_.UninstallString -and $_.UninstallString.StartsWith('"' + $expectedUninstaller + '"') })
if ($registration.Count -ne 1) { throw 'Expected exactly one test uninstall registration' }
Write-Output "INSTALL_OK seconds=$($timer.Elapsed.TotalSeconds) path=$installDir"
