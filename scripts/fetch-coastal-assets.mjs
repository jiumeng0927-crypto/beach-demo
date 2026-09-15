import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'tmp/coastal-source');
const street = process.argv.includes('--street');
const ids = street ? ['outdoor_table_chair_set_01', 'planter_box_01']
  : ['wooden_picnic_table', 'wooden_crate_02', 'plastic_crate_01', 'lifebuoy', 'lambis_shell', 'boulder_01'];

async function fetchData(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}

async function download(file, name, directory) {
  const target = path.resolve(directory, name);
  if (!target.startsWith(`${directory}${path.sep}`)) throw new Error(`Invalid asset path: ${name}`);
  let data;
  try { data = await readFile(target); } catch { /* First download. */ }
  const hash = (bytes) => createHash('md5').update(bytes).digest('hex');
  if (!data || hash(data) !== file.md5) {
    data = Buffer.from(await (await fetchData(file.url)).arrayBuffer());
    if (hash(data) !== file.md5 || data.length !== file.size) throw new Error(`Integrity failure: ${name}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return { path: name, url: file.url, md5: file.md5, bytes: data.length };
}

await mkdir(destination, { recursive: true });
const catalog = await (await fetchData('https://api.polyhaven.com/assets?t=models')).json();
const records = [];
for (const id of ids) {
  const files = await (await fetchData(`https://api.polyhaven.com/files/${id}`)).json();
  const model = files.gltf?.['1k']?.gltf;
  if (!model || !catalog[id]) throw new Error(`No public 1K glTF: ${id}`);
  const directory = path.join(destination, id);
  const name = `${id}.gltf`;
  const dependencies = [await download(model, name, directory)];
  for (const [name, file] of Object.entries(model.include ?? {})) dependencies.push(await download(file, name, directory));
  records.push({ id, name: catalog[id].name, authors: catalog[id].authors,
    source: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0',
    licenseUrl: 'https://polyhaven.com/license', file: `${id}/${name}`, dependencies });
  console.log(`${id}: ${dependencies.length} verified files`);
}
await writeFile(path.join(destination, street ? 'sources-street.json' : 'sources.json'), JSON.stringify(records, null, 2));
console.log('Coastal source assets downloaded and MD5 verified.');
