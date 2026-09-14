import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..');
const serverScript = resolve(projectRoot, 'scripts/local-server.mjs');
const webRoot = resolve(projectRoot, 'dist');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tideline-local-server-'));
const statePath = join(temporaryRoot, 'state.json');
const logPath = join(temporaryRoot, 'server.log');
const preferredPort = 41931;

function runServerCommand(argumentsList) {
  return execFileSync(process.execPath, [serverScript, ...argumentsList], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function httpRequest(url, options = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(url);
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: options.rawPath ?? `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('Request timeout')));
    req.on('error', rejectRequest);
    req.end();
  });
}

async function waitForState(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = readState();
    if (state?.url) {
      try {
        const health = await httpRequest(`${state.url}/.tideline/health`);
        if (health.status === 200) return state;
      } catch {
        // Keep polling while the detached process starts.
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Server did not start. Log:\n${readFileSync(logPath, 'utf8')}`);
}

async function waitForStop(url, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await httpRequest(`${url}/.tideline/health`);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Server did not stop in time.');
}

let state;
let portBlocker = createNetServer();
try {
  await new Promise((resolveListen, rejectListen) => {
    portBlocker.once('error', rejectListen);
    portBlocker.listen(preferredPort, '127.0.0.1', resolveListen);
  });

  const firstLaunch = runServerCommand([
    '--root', webRoot,
    '--port', String(preferredPort),
    '--state', statePath,
    '--log', logPath,
    '--no-open',
  ]);
  assert.match(firstLaunch, /started at/);
  state = await waitForState();
  assert.notEqual(state.port, preferredPort, 'Occupied preferred port should trigger fallback.');
  await new Promise((resolveClose) => portBlocker.close(resolveClose));
  portBlocker = null;

  const health = await httpRequest(`${state.url}/.tideline/health`);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).appId, 'tideline-beach-local-server');

  const index = await httpRequest(`${state.url}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.match(index.body.toString('utf8'), /<title>/);

  const assetName = readdirSync(join(webRoot, 'assets')).find((name) => name.endsWith('.js'));
  assert.ok(assetName, 'Expected a JavaScript bundle in dist/assets.');
  const assetUrl = `${state.url}/assets/${assetName}`;
  const assetHead = await httpRequest(assetUrl, { method: 'HEAD' });
  assert.equal(assetHead.status, 200);
  assert.match(assetHead.headers['content-type'], /^text\/javascript/);
  assert.equal(assetHead.body.length, 0);

  const range = await httpRequest(assetUrl, { headers: { Range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  assert.equal(range.body.length, 32);
  assert.match(range.headers['content-range'], /^bytes 0-31\//);

  const traversal = await httpRequest(state.url, { rawPath: '/%2e%2e%5cpackage.json' });
  assert.equal(traversal.status, 403);

  const fallback = await httpRequest(`${state.url}/scene/deep-link`, {
    headers: { Accept: 'text/html' },
  });
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers['content-type'], /^text\/html/);

  const firstPid = state.pid;
  const secondLaunch = runServerCommand([
    '--root', webRoot,
    '--port', String(preferredPort),
    '--state', statePath,
    '--log', logPath,
    '--no-open',
  ]);
  assert.match(secondLaunch, /already running/);
  assert.equal(readState().pid, firstPid, 'Repeated launch should reuse the existing server.');

  const stopOutput = runServerCommand(['--stop', '--state', statePath]);
  assert.match(stopOutput, /stopped at/);
  await waitForStop(state.url);

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'health endpoint',
      'HTML and JavaScript MIME types',
      'HEAD requests',
      'byte ranges',
      'path traversal rejection',
      'SPA fallback',
      'occupied-port fallback',
      'repeated-launch reuse',
      'authenticated stop',
    ],
    port: state.port,
    pidReused: firstPid,
  }, null, 2));
} finally {
  if (portBlocker) {
    await new Promise((resolveClose) => portBlocker.close(resolveClose));
  }
  const current = readState();
  if (current?.url) {
    try {
      runServerCommand(['--stop', '--state', statePath]);
    } catch {
      // The main assertion path may already have stopped the process.
    }
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
