import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('../public/textures/', import.meta.url);
await mkdir(directory, { recursive: true });
const assets = [
  { file: 'coastal-sky-2k.hdr', author: 'Greg Zaal; Jarod Guest', license: 'CC0-1.0',
    source: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    md5: '2eba3a4d7eeb23cbfbeca364c97e7980', size: 5451493 },
  { file: 'water-normal-three-r160.jpg', author: 'Three.js authors', license: 'MIT',
    source: 'https://github.com/mrdoob/three.js/blob/r160/examples/textures/waternormals.jpg',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/waternormals.jpg',
    sha256: 'add9912b158a4fe9c12421745babe68c44c8af75631ac4837236cb2a03bc373f', size: 248813 },
];
for (const asset of assets) {
  const destination = new URL(asset.file, directory);
  let bytes;
  try { bytes = await readFile(destination); } catch { /* First download. */ }
  const valid = b => b && b.length === asset.size && createHash(asset.md5 ? 'md5' : 'sha256').update(b).digest('hex') === (asset.md5 || asset.sha256);
  if (!valid(bytes)) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`${asset.file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error(`${asset.file}: asset checksum mismatch`);
    await writeFile(destination, bytes);
  }
  asset.sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`${asset.file}: verified ${asset.sha256}`);
}
await writeFile(new URL('manifest.json', directory), `${JSON.stringify(assets, null, 2)}\n`);
