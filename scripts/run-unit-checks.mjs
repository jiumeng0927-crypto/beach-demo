import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const checks = [
  'asset-integrity', 'gpu-timer', 'footstep-audio', 'camera-bookmarks',
  'ocean-swell', 'bloom', 'coastal-wind', 'cloud-quality',
  'water-reflection-quality', 'water-normal-quality', 'moon-quality',
  'star-quality', 'atmosphere-visibility', 'rain-lifecycle',
  'celestial-resource', 'discovery-resource', 'beach-billiards', 'character-system',
  'npc-appearance-unit',
  'living-coast-unit',
  'billiards-presentation-unit',
  'boundary-unit',
  'source-entry',
  'street-unit',
];
for (const check of checks) {
  const result = spawnSync(process.execPath, [`scripts/${check}-check.mjs`], {
    cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', timeout: 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS: ${checks.length} deterministic check suites`);
