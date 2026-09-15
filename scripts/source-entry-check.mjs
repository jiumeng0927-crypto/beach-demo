import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import config from '../vite.config.js';

const source = readFileSync(new URL('../dev.html', import.meta.url), 'utf8');
assert.match(source, /<script type="module" src="\/src\/main\.js"><\/script>/);
assert.doesNotMatch(source, /(?:src|href)="\.\/assets\//, 'Development must not load a publication bundle');
assert.equal(config.build.rollupOptions.input, 'dev.html');
let middleware;
config.plugins.find(plugin => plugin.name === 'tideline-source-entry').configureServer({
  middlewares: { use(handler) { middleware = handler; } },
});
for (const [url, expected] of [['/', '/dev.html'], ['/?view=shore', '/dev.html?view=shore'],
  ['/index.html', '/dev.html'], ['/assets/old.js', '/assets/old.js'], ['/src/main.js', '/src/main.js']]) {
  const request = { url }; let continued = false;
  middleware(request, {}, () => continued = true);
  assert.equal(request.url, expected); assert.equal(continued, true);
}
console.log('PASS: independent source entry, build input and query-preserving dev routing');
