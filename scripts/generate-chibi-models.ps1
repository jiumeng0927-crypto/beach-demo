$ErrorActionPreference = 'Stop'

$command = Get-Command blender -ErrorAction SilentlyContinue
$candidates = @(
  $command.Source
  'D:\blender.exe'
  'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe'
  'C:\Program Files\Blender Foundation\Blender 4.4\blender.exe'
  'C:\Program Files\Blender Foundation\Blender 4.3\blender.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$blender = $candidates | Select-Object -First 1
if (-not $blender) {
  throw 'Blender was not found. Install Blender or add blender.exe to PATH.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$generator = Join-Path $PSScriptRoot 'generate-chibi-models.py'
& $blender --background --factory-startup --python $generator
if ($LASTEXITCODE -ne 0) {
  throw "Blender character export failed with exit code $LASTEXITCODE."
}

Write-Host "Character assets updated in $projectRoot\blender and $projectRoot\public\characters."
