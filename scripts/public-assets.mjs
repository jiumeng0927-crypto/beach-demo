import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'public');
const directories = ['models/coastal', 'models/npc', 'textures', 'audio/billiards'];

export function verifiedPublicFiles() {
  const files = ['favicon.svg'];
  for (const directory of directories) {
    const manifest = `${directory}/manifest.json`;
    const entries = JSON.parse(readFileSync(resolve(root, manifest), 'utf8'));
    assert.ok(entries.length > 0, `Empty asset manifest: ${manifest}`);
    files.push(manifest);
    for (const entry of entries) {
      assert.match(entry.file, /^[a-z0-9_-]+\.(glb|hdr|jpg|mp3)$/);
      assert.ok(['CC0-1.0', 'MIT'].includes(entry.license), `Unknown license: ${entry.file}`);
      assert.match(entry.source, /^https:\/\//);
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      const name = `${directory}/${entry.file}`;
      const bytes = readFileSync(resolve(root, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Asset checksum: ${name}`);
      if (entry.size ?? entry.bytes) assert.equal(bytes.length, entry.size ?? entry.bytes, `Asset size: ${name}`);
      files.push(name);
    }
  }
  assert.equal(new Set(files).size, files.length, 'Duplicate asset entries');
  return files;
}
