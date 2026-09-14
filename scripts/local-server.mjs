import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const APP_ID = 'tideline-beach-local-server';
const SERVER_VERSION = 1;
const DEFAULT_PORT = 5175;
const PORT_ATTEMPTS = 21;
const HEALTH_PATH = '/.tideline/health';
const STOP_PATH = '/.tideline/stop';
const SERVER_SCRIPT = fileURLToPath(import.meta.url);

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json; charset=utf-8'],
  ['.hdr', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.ktx2', 'image/ktx2'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function parseArguments(argv) {
  const options = {
    root: 'dist',
    port: DEFAULT_PORT,
    open: false,
    serve: false,
    stop: false,
    status: false,
    state: '.tideline-server.json',
    log: '.tideline-server.log',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split('=', 2);
    const readValue = () => inlineValue ?? argv[++index];

    if (flag === '--root') options.root = readValue();
    else if (flag === '--port') options.port = Number.parseInt(readValue(), 10);
    else if (flag === '--state') options.state = readValue();
    else if (flag === '--log') options.log = readValue();
    else if (flag === '--open') options.open = true;
    else if (flag === '--no-open') options.open = false;
    else if (flag === '--serve') options.serve = true;
    else if (flag === '--stop') options.stop = true;
    else if (flag === '--status') options.status = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  options.root = resolve(options.root);
  options.state = resolve(options.state);
  options.log = resolve(options.log);
  return options;
}

function readState(statePath) {
  try {
    const value = JSON.parse(readFileSync(statePath, 'utf8'));
    return value?.appId === APP_ID ? value : null;
  } catch {
    return null;
  }
}

function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, statePath);
}

function removeOwnState(statePath) {
  const state = readState(statePath);
  if (state?.pid === process.pid) rmSync(statePath, { force: true });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    signal: AbortSignal.timeout(options.timeout ?? 1200),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getHealthyState(statePath) {
  const state = readState(statePath);
  if (!state?.url || !state?.pid) return null;

  try {
    const health = await requestJson(`${state.url}${HEALTH_PATH}`);
    if (health.appId === APP_ID && health.pid === state.pid) return state;
  } catch {
    // A stale state file is removed before the replacement server starts.
  }
  return null;
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

function isInsideRoot(root, filePath) {
  const pathFromRoot = relative(root, filePath);
  return pathFromRoot === '' || (
    !pathFromRoot.startsWith(`..${sep}`)
    && pathFromRoot !== '..'
    && !isAbsolute(pathFromRoot)
  );
}

function resolveRequestPath(root, rawPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname).replaceAll('\\', '/');
  } catch {
    return null;
  }

  if (pathname.includes('\0') || pathname.split('/').includes('..')) return null;
  const filePath = resolve(root, `.${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  return isInsideRoot(root, filePath) ? filePath : null;
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader?.startsWith('bytes=') || rangeHeader.includes(',')) return null;
  const [startText, endText] = rangeHeader.slice(6).split('-', 2);
  let start = startText === '' ? Number.NaN : Number.parseInt(startText, 10);
  let end = endText === '' ? Number.NaN : Number.parseInt(endText, 10);

  if (Number.isNaN(start)) {
    const suffixLength = end;
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    if (!Number.isInteger(start) || start < 0 || start >= size) return null;
    if (!Number.isInteger(end) || end >= size) end = size - 1;
  }

  if (end < start) return null;
  return { start, end };
}

function sendJson(response, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(message),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

function createStaticServer({ root, token, statePath }) {
  let port = 0;
  let shuttingDown = false;
  const indexPath = join(root, 'index.html');

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (requestUrl.pathname === HEALTH_PATH) {
      sendJson(response, 200, {
        ok: true,
        appId: APP_ID,
        serverVersion: SERVER_VERSION,
        pid: process.pid,
        port,
      });
      return;
    }

    if (requestUrl.pathname === STOP_PATH) {
      if (request.method !== 'POST' || request.headers['x-tideline-token'] !== token) {
        sendJson(response, 403, { ok: false });
        return;
      }

      sendJson(response, 200, { ok: true, stopping: true });
      setImmediate(() => shutdown());
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }

    let filePath = resolveRequestPath(root, requestUrl.pathname);
    if (!filePath) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    try {
      const requestedStat = statSync(filePath);
      if (requestedStat.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      const acceptsHtml = request.headers.accept?.includes('text/html');
      if (acceptsHtml && extname(filePath) === '') filePath = indexPath;
    }

    let fileStat;
    try {
      fileStat = statSync(filePath);
      if (!fileStat.isFile() || !isInsideRoot(root, filePath)) throw new Error('Not a file');
    } catch {
      sendText(response, 404, 'Not found');
      return;
    }

    const etag = `W/\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}\"`;
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }

    const range = parseRange(request.headers.range, fileStat.size);
    if (request.headers.range && !range) {
      response.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` });
      response.end();
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const immutableAsset = /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(filePath));
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': filePath === indexPath
        ? 'no-cache'
        : immutableAsset
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      'Content-Type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
      ETag: etag,
      'Last-Modified': fileStat.mtime.toUTCString(),
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    };

    if (range) {
      headers['Content-Length'] = range.end - range.start + 1;
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${fileStat.size}`;
      response.writeHead(206, headers);
    } else {
      headers['Content-Length'] = fileStat.size;
      response.writeHead(200, headers);
    }

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(filePath, range ?? undefined);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });

  server.on('clientError', (error, socket) => {
    if (error.code !== 'ECONNRESET' && socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      removeOwnState(statePath);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }

  return {
    server,
    setPort(value) {
      port = value;
    },
    shutdown,
  };
}

async function listenWithFallback(server, preferredPort) {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const port = preferredPort + offset;
    try {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => rejectListen(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError);
          resolveListen();
        });
      });
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No free local port found between ${preferredPort} and ${preferredPort + PORT_ATTEMPTS - 1}`);
}

async function runServer(options) {
  const indexPath = join(options.root, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`Web build not found: ${indexPath}`);

  const token = randomBytes(24).toString('hex');
  const staticServer = createStaticServer({ root: options.root, token, statePath: options.state });
  const port = await listenWithFallback(staticServer.server, options.port);
  staticServer.setPort(port);
  const url = `http://127.0.0.1:${port}`;

  writeState(options.state, {
    appId: APP_ID,
    serverVersion: SERVER_VERSION,
    pid: process.pid,
    port,
    root: options.root,
    token,
    startedAt: new Date().toISOString(),
    url,
  });

  process.on('SIGINT', staticServer.shutdown);
  process.on('SIGTERM', staticServer.shutdown);
  process.on('exit', () => removeOwnState(options.state));
  console.log(`Tideline is available at ${url}`);
}

async function waitForStartedServer(statePath, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await getHealthyState(statePath);
    if (state) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  return null;
}

async function launchServer(options) {
  const existing = await getHealthyState(options.state);
  if (existing) {
    console.log(`Tideline is already running at ${existing.url}`);
    if (options.open) openBrowser(existing.url);
    return;
  }

  rmSync(options.state, { force: true });
  mkdirSync(dirname(options.log), { recursive: true });
  const logFd = openSync(options.log, 'a');
  const child = spawn(
    process.execPath,
    [
      SERVER_SCRIPT,
      '--serve',
      '--root',
      options.root,
      '--port',
      String(options.port),
      '--state',
      options.state,
      '--log',
      options.log,
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    },
  );
  child.unref();
  closeSync(logFd);

  const state = await waitForStartedServer(options.state);
  if (!state) throw new Error(`Local server did not become ready. Check ${options.log}`);

  console.log(`Tideline started at ${state.url}`);
  if (options.open) openBrowser(state.url);
}

async function stopServer(options) {
  const state = await getHealthyState(options.state);
  if (!state) {
    rmSync(options.state, { force: true });
    console.log('Tideline is not running.');
    return;
  }

  await requestJson(`${state.url}${STOP_PATH}`, {
    method: 'POST',
    headers: { 'x-tideline-token': state.token },
  });
  console.log(`Tideline stopped at ${state.url}`);
}

async function showStatus(options) {
  const state = await getHealthyState(options.state);
  if (!state) {
    console.log('Tideline status: stopped');
    process.exitCode = 1;
    return;
  }
  console.log(`Tideline status: running\nURL: ${state.url}\nPID: ${state.pid}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.stop) await stopServer(options);
  else if (options.status) await showStatus(options);
  else if (options.serve) await runServer(options);
  else await launchServer(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
