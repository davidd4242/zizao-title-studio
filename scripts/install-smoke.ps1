$installer = 'F:\dnowload\封面\title-studio\release\字造-1.5.0-完整安装版.exe'
$target = 'F:\dnowload\封面\title-studio\verification\installer-1.5.0\installed'
$process = Start-Process -FilePath $installer -ArgumentList '/S', "/D=$target" -Wait -PassThru
Write-Output ("exit=" + $process.ExitCode)
if (Test-Path $target) {
  $root = Get-ChildItem $target -File | Measure-Object
  Write-Output ("rootFiles=" + $root.Count)
  $extras = Join-Path $target '使用说明'
  if (Test-Path $extras) {
    Get-ChildItem $extras | ForEach-Object { Write-Output ("extra=" + $_.Name + " " + $_.Length) }
  } else {
    Write-Output 'extras=missing'
  }
  $shortcuts = Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter '字造*.lnk' -ErrorAction SilentlyContinue
  Write-Output ("desktopShortcuts=" + ($shortcuts | Measure-Object).Count)
} else {
  Write-Output 'installedDir=missing'
}
