import { verifiedPublicFiles } from './public-assets.mjs';

console.log(JSON.stringify({ ok: true, files: verifiedPublicFiles() }, null, 2));
