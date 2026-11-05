$report = [System.Collections.Generic.List[string]]::new()
foreach ($proc in Get-Process -Name '字造' -ErrorAction SilentlyContinue) {
  $report.Add("proc=" + $proc.Id + " path=" + $proc.Path)
}
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | ForEach-Object {
  $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($item.DisplayName -like '*字造*') {
    $report.Add("uninstallKey=" + $_.PSChildName + " name=" + $item.DisplayName + " location=" + $item.InstallLocation)
  }
}
foreach ($link in Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter '字造*.lnk') {
  $shell = New-Object -ComObject WScript.Shell
  $target = $shell.CreateShortcut($link.FullName).TargetPath
  $report.Add("shortcut=" + $link.Name + " -> " + $target)
}
$report | ForEach-Object { Write-Output $_ }
