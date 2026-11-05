import http from 'node:http';
import { randomInt } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ApiError, validateOutline } from './outline.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopback = hostname => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname.toLowerCase());
const mediaTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function createFontService(options) {
  let worker;
  let closed = false;
  let sequence = 0;
  const pending = new Map();
  const fail = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const boot = () => {
    worker = new Worker(new URL('./font-worker.mjs', import.meta.url), { workerData: { dataDir: options.dataDir || path.join(projectDir, 'data'), fontDirectories: options.fontDirectories || [], includeSystemFonts: options.includeSystemFonts, includeBundledFonts: options.includeBundledFonts, bundledFontsDir: options.bundledFontsDir, scanRegistry: options.scanRegistry }, execArgv: [] });
    worker.on('message', message => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new ApiError(message.error.status, message.error.message));
      else request.resolve(message.result);
      if (!pending.size) worker?.unref();
    });
    worker.on('error', error => fail(new ApiError(500, `字体工作线程错误: ${error.message}`)));
    worker.on('exit', () => {
      worker = undefined;
      if (!closed) fail(new ApiError(503, '字体工作线程已退出'));
    });
  };
  return {
    request(operation, value) {
      if (closed) return Promise.reject(new ApiError(503, '字体服务已关闭'));
      if (pending.size >= 64) return Promise.reject(new ApiError(429, '字体请求过多，请稍后重试'));
      if (!worker) boot();
      worker.ref();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, operation, value });
      });
    },
    async close() {
      closed = true;
      fail(new ApiError(503, '字体服务已关闭'));
      if (worker) await worker.terminate();
    },
  };
}

// A Photoshop CEP panel is a file:// page; its <iframe> navigation to this server arrives with
// Sec-Fetch-Site: cross-site and no Origin. Only that exact shape (a GET/HEAD document navigation
// into an iframe, never an /api/ route) may pass, and only when the caller opts in.
function framedNavigation(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'iframe') return false;
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]).toLowerCase(); } catch { return false; }
  return !pathname.startsWith('/api/') && pathname !== '/api' && !pathname.startsWith('/__bridge/');
}
function guardLocal(req, res, options = {}) {
  const address = req.socket.remoteAddress;
  if (address && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) throw new ApiError(403, '仅接受本机连接');
  let host;
  try { host = new URL(`http://${req.headers.host || ''}`); } catch { throw new ApiError(403, 'Host 无效'); }
  if (!loopback(host.hostname) || host.username || host.password || host.pathname !== '/') throw new ApiError(403, '仅接受本地 Host');
  const origin = req.headers.origin;
  if (origin) {
    let url;
    try { url = new URL(origin); } catch { throw new ApiError(403, 'Origin 无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || !loopback(url.hostname) || url.origin !== origin || url.username || url.password) throw new ApiError(403, '仅接受本地 Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (req.headers['sec-fetch-site'] === 'cross-site' && !(options.allowFramedNavigation && framedNavigation(req))) throw new ApiError(403, '拦截外站请求');
}
function json(res, status, value) {
  if (res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, '请使用 application/json');
  const encoding = req.headers['content-encoding'];
  if (encoding && encoding !== 'identity') throw new ApiError(415, '不支持压缩请求体');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) { req.resume(); throw new ApiError(413, '请求体过大'); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > limit) {
        chunks.length = 0;
        if (!settled) { settled = true; reject(new ApiError(413, '请求体过大')); }
      } else if (!settled) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new ApiError(400, '请求已中断')));
    req.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
        resolve(value);
      } catch { reject(new ApiError(400, 'JSON 请求格式无效')); }
    });
  });
}
function requestPath(req) {
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); } catch { throw new ApiError(400, 'URL 编码无效'); }
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\:\x00-\x1f]/.test(pathname) || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) throw new ApiError(403, '路径无效');
  return pathname;
}
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
async function serveStatic(req, res, pathname, directory) {
  let root;
  try { root = await realpath(directory); } catch { throw new ApiError(503, '请先运行 npm run build 生成 dist'); }
  let file = path.resolve(root, `.${pathname}`);
  if (!inside(root, file)) throw new ApiError(403, '路径越界');
  let info;
  try { info = await stat(file); } catch {}
  if (!info?.isFile()) {
    if (path.extname(pathname)) throw new ApiError(404, '文件不存在');
    file = path.join(root, 'index.html');
  }
  try {
    file = await realpath(file);
    if (!inside(root, file)) throw new ApiError(403, '路径越界');
    info = await stat(file);
    if (!info.isFile()) throw new ApiError(404, '文件不存在');
  } catch (error) {
    if (error.status) throw error;
    throw new ApiError(404, '文件不存在');
  }
  const headers = { 'Content-Type': mediaTypes[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' };
  if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); }
  else { const bytes = await readFile(file); res.writeHead(200, headers); res.end(bytes); }
}

export function createServer(options = {}) {
  const fonts = createFontService(options);
  const staticDir = path.resolve(options.staticDir || path.join(projectDir, 'dist'));
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      guardLocal(req, res, { allowFramedNavigation: options.allowFramedNavigation === true });
      const pathname = requestPath(req);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        res.end();
        return;
      }
      if (pathname === '/api/fonts') {
        if (req.method !== 'GET') throw new ApiError(405, '此接口使用 GET');
        const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
        json(res, 200, await fonts.request(refresh ? 'refresh' : 'catalog'));
      } else if (['/api/fonts/directory', '/api/fonts/import', '/api/outline'].includes(pathname)) {
        if (req.method !== 'POST') throw new ApiError(405, '此接口使用 POST');
        const operation = pathname.endsWith('/directory') ? 'directory' : pathname.endsWith('/import') ? 'import' : 'outline';
        const body = await readJson(req, operation === 'import' ? 112 * 1024 * 1024 : 64 * 1024);
        if (operation === 'outline') validateOutline(body);
        json(res, 200, await fonts.request(operation, body));
      } else if (pathname.startsWith('/api/')) throw new ApiError(404, '接口不存在');
      else {
        if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, '静态文件使用 GET 或 HEAD');
        await serveStatic(req, res, pathname, staticDir);
      }
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务处理失败' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.fontService = fonts;
  server.on('close', () => { void fonts.close(); });
  return server;
}

export async function listenLocal(server, port = 0, host = '127.0.0.1') {
  if (!loopback(host)) throw new ApiError(400, '服务地址必须为本机回环地址');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ApiError(400, '服务端口无效');
  // Automatic ports stay above every WHATWG/Chromium restricted service port.
  // Do not close/rebind after listening: close also shuts down the font service.
  const base = port || randomInt(49152, 65536);
  const attempts = port ? 1 : 128;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = port || 49152 + ((base - 49152 + attempt) % 16384);
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed).once('listening', ready);
        try { server.listen(candidate, host); }
        catch (error) { server.off('error', failed).off('listening', ready); reject(error); }
      });
      return server;
    } catch (error) {
      if (port || !['EADDRINUSE', 'EACCES'].includes(error.code) || attempt + 1 === attempts) throw error;
    }
  }
}

export async function start(options = {}) {
  const server = createServer(options);
  try { return await listenLocal(server, options.port ?? 4178, options.host || '127.0.0.1'); }
  catch (error) { await server.fontService.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start({ port: process.env.PORT ? Number(process.env.PORT) : 4178 }).then(server => {
    console.log(`Title Studio: http://127.0.0.1:${server.address().port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
