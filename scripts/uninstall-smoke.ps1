$target = 'F:\dnowload\封面\title-studio\verification\installer-1.5.0\installed'
$uninstaller = Join-Path $target 'Uninstall 字造.exe'
if (Test-Path $uninstaller) {
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  Write-Output ("uninstallExit=" + $process.ExitCode)
} else {
  Write-Output 'uninstaller=missing'
}
Start-Sleep -Seconds 4
Write-Output ("installDirExists=" + (Test-Path $target))
if (Test-Path $target) {
  $left = Get-ChildItem $target -Force
  Write-Output ("leftover=" + (($left | ForEach-Object { $_.Name }) -join ','))
}
$shortcuts = Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter '字造*.lnk' -ErrorAction SilentlyContinue
Write-Output ("desktopShortcuts=" + (($shortcuts | ForEach-Object { $_.Name }) -join ','))
$key = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like '*字造*' }
Write-Output ("uninstallKeys=" + (($key | ForEach-Object { $_.PSChildName }) -join ','))
