[CmdletBinding()]
param([string]$ExtensionDirectory = (Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
$ErrorActionPreference = 'Stop'
$Id = 'com.zizao.title-studio'
$Destination = Join-Path $ExtensionDirectory $Id
$Data = Join-Path $env:LOCALAPPDATA 'ZizaoPhotoshop'
$StatePath = Join-Path $Data 'install-state.json'
if (Test-Path -LiteralPath $Destination) {
    $Manifest = Join-Path $Destination 'CSXS\manifest.xml'
    if (-not (Test-Path -LiteralPath $Manifest) -or (Get-Content -LiteralPath $Manifest -Raw) -notmatch 'com\.zizao\.title-studio') { throw 'Extension identity mismatch; directory was left as-is.' }
    $Backup = Join-Path $Data ('backups\uninstalled-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path (Split-Path $Backup) -Force | Out-Null
    Move-Item -LiteralPath $Destination -Destination $Backup
    Write-Output "Removed extension from Photoshop. Recovery copy: $Backup"
}
if (Test-Path -LiteralPath $StatePath) {
    $State = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($State.id -eq $Id -and $State.destination -eq [IO.Path]::GetFullPath($Destination)) {
        if ($State.developerModeChanged) {
            $Registry = 'HKCU:\Software\Adobe\CSXS.12'
            $Current = (Get-ItemProperty -LiteralPath $Registry -ErrorAction SilentlyContinue).PlayerDebugMode
            if ([string]$Current -eq '1') {
                if ($null -eq $State.previousDebugValue) { Remove-ItemProperty -LiteralPath $Registry -Name PlayerDebugMode -ErrorAction SilentlyContinue }
                else { New-ItemProperty -LiteralPath $Registry -Name PlayerDebugMode -Value $State.previousDebugValue -PropertyType $State.previousDebugKind -Force | Out-Null }
            }
        }
        Move-Item -LiteralPath $StatePath -Destination (Join-Path $Data ('uninstalled-state-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json'))
    }
}
Write-Output 'Restart Photoshop to refresh its extension menu. Font cache, linked directories and project data remain available.'
