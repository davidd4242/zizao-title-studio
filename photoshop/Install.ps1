[CmdletBinding()]
param([switch]$EnableDeveloperMode, [string]$ExtensionDirectory = (Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
$ErrorActionPreference = 'Stop'
$Id = 'com.zizao.title-studio'
$Source = Join-Path $PSScriptRoot $Id
$Destination = Join-Path $ExtensionDirectory $Id
$Data = Join-Path $env:LOCALAPPDATA 'ZizaoPhotoshop'
$StatePath = Join-Path $Data 'install-state.json'
$Registry = 'HKCU:\Software\Adobe\CSXS.12'
$ManifestPath = Join-Path $Source 'package-manifest.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) { throw 'Extract the complete ZIP before running Install.ps1.' }
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Manifest.name -ne $Id) { throw 'Package identity mismatch.' }
$SourcePrefix = [IO.Path]::GetFullPath($Source) + [IO.Path]::DirectorySeparatorChar
$Missing = @()
$Corrupt = @()
foreach ($Entry in $Manifest.files) {
    $File = [IO.Path]::GetFullPath((Join-Path $Source $Entry.file))
    if (-not $File.StartsWith($SourcePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escapes extension directory.' }
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { $Missing += $Entry.file; continue }
    if ((Get-Item -LiteralPath $File).Length -ne $Entry.size -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Entry.sha256) { $Corrupt += $Entry.file }
}
if ($Missing.Count -or $Corrupt.Count) {
    $Samples = @(@($Missing) + @($Corrupt) | Select-Object -First 3) -join '; '
    throw ("Package is incomplete: {0} of {1} files are missing and {2} are damaged (for example: {3}). " +
        "The ZIP was not fully extracted, or an antivirus removed files while it was unpacking. " +
        "Delete this folder, extract the whole ZIP again into an empty folder, let it finish without cancelling, then run Install.cmd again.") `
        -f $Missing.Count, $Manifest.files.Count, $Corrupt.Count, $Samples
}
$RegistryItem = Get-ItemProperty -LiteralPath $Registry -ErrorAction SilentlyContinue
$OldValue = if ($RegistryItem) { $RegistryItem.PlayerDebugMode } else { $null }
if ([string]$OldValue -ne '1' -and -not $EnableDeveloperMode) { throw 'This unsigned CEP package needs PlayerDebugMode=1 for CSXS.12. Run Install.ps1 -EnableDeveloperMode to enable it explicitly; uninstall restores its previous value.' }
$State = @{ id=$Id; version=$Manifest.version; destination=[IO.Path]::GetFullPath($Destination); developerModeChanged=$false; previousDebugValue=$OldValue; previousDebugKind=$null }
if (Test-Path -LiteralPath $StatePath) {
    $Prior = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Prior.id -eq $Id -and $Prior.developerModeChanged) { $State.developerModeChanged=$true; $State.previousDebugValue=$Prior.previousDebugValue; $State.previousDebugKind=$Prior.previousDebugKind }
}
New-Item -ItemType Directory -Path $ExtensionDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $Data -Force | Out-Null
$Stage = Join-Path $ExtensionDirectory ('.zizao-install-' + [Guid]::NewGuid().ToString('N'))
$Backup = $null
try {
    Copy-Item -LiteralPath $Source -Destination $Stage -Recurse
    if (Test-Path -LiteralPath $Destination) {
        $Existing = Join-Path $Destination 'CSXS\manifest.xml'
        if (-not (Test-Path -LiteralPath $Existing) -or (Get-Content -LiteralPath $Existing -Raw) -notmatch 'com\.zizao\.title-studio') { throw 'Existing directory belongs to another extension.' }
        $Backup = Join-Path $Data ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path (Split-Path $Backup) -Force | Out-Null
        Move-Item -LiteralPath $Destination -Destination $Backup
    }
    Move-Item -LiteralPath $Stage -Destination $Destination
    if ([string]$OldValue -ne '1') {
        if ($null -ne $OldValue) { $State.previousDebugKind = (Get-Item -LiteralPath $Registry).GetValueKind('PlayerDebugMode').ToString() }
        New-Item -Path $Registry -Force | Out-Null
        New-ItemProperty -LiteralPath $Registry -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
        $State.developerModeChanged = $true
    }
    $State | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    Write-Output "Installed Zizao $($Manifest.version): $Destination"
    Write-Output 'Restart Photoshop, then open Window > Extensions (Legacy) > Zizao.'
    Write-Output 'No system fonts or application files were installed. Existing project files were left as-is.'
} catch {
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
    if ($Backup -and (Test-Path -LiteralPath $Backup) -and -not (Test-Path -LiteralPath $Destination)) { Move-Item -LiteralPath $Backup -Destination $Destination }
    throw
}
