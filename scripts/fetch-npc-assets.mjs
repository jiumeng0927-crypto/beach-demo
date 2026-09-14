import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const assets = [
  ['Female', '17O7eSD7xunnN10MQiQcFOQ_EPvRR9_M3', 'df3dae4a16a7e331c0b7662f768cb4eabe8fb0863e9ab09cbfdf3031cf8d8955'],
  ['Male', '1Mig1cMlBWgQ_H8FxlWkfNeXFkNeclyCl', 'ca9c264a4549eb664c6945db053ea2db1d0809a98ffc55cc2800e5dd09ecf55f'],
];
const folder = resolve(import.meta.dirname, '../tmp/npc-source');
await mkdir(folder, { recursive: true });
for (const [gender, id, hash] of assets) {
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: ${gender} HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.subarray(0, 7).toString() !== 'BLENDER' || createHash('sha256').update(data).digest('hex') !== hash) {
    throw new Error(`Unexpected author asset: ${gender}`);
  }
  await writeFile(resolve(folder, `Casual_${gender}.blend`), data);
  console.log(`${gender}: source SHA256 verified (${data.length} bytes)`);
}
