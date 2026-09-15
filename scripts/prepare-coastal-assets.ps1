param([switch]$Street, [switch]$Details)
$ErrorActionPreference = 'Stop'
$command = Get-Command blender -ErrorAction SilentlyContinue
$candidates = @(
  $command.Source
  'D:\blender.exe'
  'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe'
  'C:\Program Files\Blender Foundation\Blender 4.4\blender.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$blender = $candidates | Select-Object -First 1
if (-not $blender) { throw 'Blender 4.4+ was not found. Add blender.exe to PATH.' }
$extra = @()
if ($Street) { $extra = @('--', '--street') }
$script = if ($Details) { 'prepare-small-props.py' } else { 'prepare-coastal-assets.py' }
& $blender --background --factory-startup --python-exit-code 1 --python (Join-Path $PSScriptRoot $script) @extra
if ($LASTEXITCODE -ne 0) { throw "Coastal asset preparation failed: $LASTEXITCODE" }
