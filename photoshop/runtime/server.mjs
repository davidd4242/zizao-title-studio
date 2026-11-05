import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function startEditor(options = {}) {
  const token = options.token || process.env.ZIZAO_TOKEN;
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('A 256-bit instance token is required.');
  const editorRoot = options.editorRoot || path.join(extensionRoot, 'packages/editor');
  const { createServer, listenLocal } = await import(pathToFileURL(path.join(editorRoot, 'server/index.mjs')).href);
  const server = createServer({
    staticDir: path.join(editorRoot, 'dist'),
    dataDir: options.dataDir || process.env.ZIZAO_DATA_DIR,
    bundledFontsDir: path.join(editorRoot, 'assets/fonts'),
    includeSystemFonts: options.includeSystemFonts,
    includeBundledFonts: options.includeBundledFonts,
    scanRegistry: options.scanRegistry,
    fontDirectories: options.fontDirectories,
    // The panel page is file://, so the editor iframe navigation is cross-site by definition.
    // API and bridge routes stay token-gated below and cross-site-blocked in guardLocal.
    allowFramedNavigation: true,
  });
  const original = server.listeners('request')[0];
  server.removeAllListeners('request');
  const expected = Buffer.from(token);
  const reply = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  server.on('request', (req, res) => {
    const port = server.address()?.port;
    if (req.headers.host !== `127.0.0.1:${port}`) { reply(res, 403, { error: 'Host does not match this panel instance.' }); return; }
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch { reply(res, 400, { error: 'URL encoding is invalid.' }); return; }
    if (pathname.startsWith('/api/') || pathname.startsWith('/__bridge/')) {
      const supplied = Buffer.from(typeof req.headers['x-zizao-token'] === 'string' ? req.headers['x-zizao-token'] : '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { reply(res, 403, { error: 'Panel instance token is required.' }); return; }
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}`) { reply(res, 403, { error: 'Origin does not match this panel instance.' }); return; }
      if (pathname === '/__bridge/health') { reply(res, 200, { ready: true, runtime: process.version }); return; }
    }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'");
    void original(req, res);
  });
  // A default port the operating system refuses is as unusable as one another panel owns:
  // Windows excluded port ranges (e.g. netsh excludedportrange) answer a bind with EACCES, and a
  // reserved port answers with EPERM. Only an explicitly requested port may surface the error.
  const requested = options.port;
  try { await listenLocal(server, requested ?? 4200, '127.0.0.1'); }
  catch (error) {
    const portUnusable = error.code === 'EADDRINUSE' || error.code === 'EACCES' || error.code === 'EPERM';
    if (portUnusable && requested === undefined) await listenLocal(server, 0, '127.0.0.1');
    else throw error;
  }
  let closing;
  const close = () => closing ||= (async () => {
    server.closeIdleConnections();
    await server.fontService.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  })();
  return { server, origin: `http://127.0.0.1:${server.address().port}`, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const runtime = await startEditor();
  process.stdout.write(JSON.stringify({ type: 'zizao:server-ready', origin: runtime.origin, pid: process.pid }) + '\n');
  let shuttingDown = false;
  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(parentCheck);
    await runtime.close();
    process.exit(0);
  };
  process.stdin.resume();
  process.stdin.once('end', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const parent = Number(process.env.ZIZAO_PARENT_PID);
  const parentCheck = setInterval(() => {
    if (Number.isSafeInteger(parent) && parent > 0) {
      try { process.kill(parent, 0); } catch { void stop(); }
    }
  }, 5000);
  parentCheck.unref();
}
