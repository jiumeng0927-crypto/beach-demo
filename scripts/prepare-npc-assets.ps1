$ErrorActionPreference = 'Stop'
$command = Get-Command blender -ErrorAction SilentlyContinue
$blender = @($command.Source, 'D:\blender.exe', 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe') |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $blender) { throw 'Blender 4.5 required; add it to PATH.' }
foreach ($gender in @('Female', 'Male')) {
  & $blender --background --factory-startup --python-exit-code 1 --python (Join-Path $PSScriptRoot 'prepare-npc-assets.py') -- $gender
  if ($LASTEXITCODE -ne 0) { throw "NPC preparation failed: $gender" }
}
