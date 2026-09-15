import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifiedPublicFiles } from './public-assets.mjs';

const root = resolve(import.meta.dirname, '..');
const files = ['index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', ...verifiedPublicFiles()];
// Validate before updating the tracked manual-publication snapshot. No deletes.
for (const name of files) {
  if (!existsSync(resolve(root, 'dist', name))) throw new Error(`Missing dist/${name}; run npm run build first.`);
}
for (const directory of ['assets', 'licenses']) {
  if (!existsSync(resolve(root, 'dist', directory))) throw new Error(`Missing dist/${directory}; run npm run build first.`);
}
cpSync(resolve(root, 'dist/assets'), resolve(root, 'assets'), { recursive: true });
cpSync(resolve(root, 'dist/licenses'), resolve(root, 'licenses'), { recursive: true });
for (const name of files.filter(name => name !== 'index.html')) {
  const destination = resolve(root, name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, 'dist', name), destination);
}
// Publish the entry last, atomically, after every referenced asset is present.
const pendingEntry = resolve(root, '.tideline-index.tmp');
copyFileSync(resolve(root, 'dist/index.html'), pendingEntry);
renameSync(pendingEntry, resolve(root, 'index.html'));
console.log('Updated root web snapshot from dist. Source preserved; nothing uploaded.');
