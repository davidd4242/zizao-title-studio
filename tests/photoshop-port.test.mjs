import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startEditor } from '../photoshop/runtime/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'd'.repeat(64);
const active = [];
const DEFAULT_PORT = 4200;
let directory, fonts, owner, blocker, ownerPort, blockerPort, defaultPortOwned = false;
const options = () => ({ token, editorRoot: root, dataDir: path.join(directory, `data-${active.length}`), fontDirectories: [fonts], includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false });
const headers = { 'X-Zizao-Token': token };

function bind(server, port) {
  return new Promise((resolve, reject) => {
    const failed = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolve(); };
    server.once('error', failed).once('listening', ready).listen(port, '127.0.0.1');
  });
}
function raw(origin, route, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin + route, { headers: extraHeaders }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
    });
    req.once('error', reject); req.end();
  });
}
function highPort(runtime) {
  const port = Number(new URL(runtime.origin).port);
  assert.ok(port >= 49152 && port <= 65535, `Browser-facing fallback port ${port} is in the dynamic high range`);
  assert.equal(runtime.server.address().port, port);
  return port;
}
const ownerServer = () => createServer((req, res) => {
  if (req.url === '/frame' && active[0]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<iframe src="${active[0].origin}/?photoshop=cep#zizao-token=${token}" style="width:1200px;height:800px;border:0"></iframe>`);
  } else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('owner'); }
});

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'zizao-cep-port-'));
  fonts = path.join(directory, 'fonts');
  await mkdir(fonts);
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/fonts/manifest.json'), 'utf8'));
  const font = manifest.fonts.find(item => item.slug === 'bangers');
  assert.ok(font);
  await copyFile(path.join(root, 'assets/fonts', font.file), path.join(fonts, 'bangers.ttf'));
  // The contract under test is "the default port is not available, so start on a free high port".
  // Own 4200 when the OS permits it. Windows excluded port ranges (netsh interface ipv4 show
  // excludedportrange) refuse the bind with EACCES; that is still "the default port is not
  // available", it just reaches the fallback through a different errno, so the same contract is
  // exercised. No assertion below is relaxed by this branch.
  owner = ownerServer();
  try { await bind(owner, DEFAULT_PORT); defaultPortOwned = true; }
  catch (error) {
    assert.equal(error.code, 'EACCES', 'the default port may only be skipped when the OS reserves it');
    owner = ownerServer();
    await bind(owner, 0);
  }
  ownerPort = owner.address().port;
  assert.ok(ownerPort > 0);
  // A port that is ours and definitely joinable, so the explicit-port rejection assertion stays
  // exactly EADDRINUSE regardless of platform reservations.
  blocker = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('blocked'); });
  await bind(blocker, 0);
  blockerPort = blocker.address().port;
  assert.notEqual(blockerPort, ownerPort);
});
after(async () => {
  await Promise.all(active.map(runtime => runtime.close()));
  for (const server of [owner, blocker]) {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  if (directory) {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'zizao-cep-port-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('occupied default port falls back to distinct high ports and keeps the real font worker alive', async t => {
  for (let index = 0; index < 2; index++) {
    const runtime = await startEditor(options());
    active.push(runtime);
    const port = highPort(runtime);
    const health = await fetch(runtime.origin + '/__bridge/health', { headers });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ready: true, runtime: process.version });
    const response = await fetch(runtime.origin + '/api/fonts', { headers });
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.equal(catalog.fonts.length, 1);
    assert.match(catalog.fonts[0].fullName, /Bangers/);
    const shaped = await fetch(runtime.origin + '/api/outline', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontId: catalog.fonts[0].id, text: 'PORT', fontSize: 100, letterSpacing: 0, lineHeight: 1.2, align: 'left', layout: 'horizontal' }),
    });
    assert.equal(shaped.status, 200);
    const outline = await shaped.json();
    assert.equal(outline.glyphs.length, 4);
    assert.ok(outline.glyphs.every(glyph => glyph.commands.length > 0));
    t.diagnostic(`Fallback ${index + 1}: ${port}; real Bangers worker shaped ${outline.glyphs.length} glyphs`);
  }
  assert.equal(new Set(active.map(highPort)).size, 2);
  if (defaultPortOwned) {
    assert.equal(await (await fetch(`http://127.0.0.1:${DEFAULT_PORT}/`)).text(), 'owner');
    t.diagnostic(`Default port ${DEFAULT_PORT} was owned by the test, so EADDRINUSE drove the fallback`);
  } else {
    const probe = createServer((req, res) => res.end());
    await assert.rejects(bind(probe, DEFAULT_PORT), { code: 'EACCES' });
    t.diagnostic(`Default port ${DEFAULT_PORT} is reserved by Windows (excluded port range), so EACCES drove the same fallback`);
  }
});

test('fallback preserves token, encoded-path, exact Host/Origin and CSP checks', async () => {
  const runtime = active[0];
  for (const route of ['/api/fonts', '/%61pi/fonts', '/api%2Ffonts', '/__bridge/health']) {
    assert.equal((await raw(runtime.origin, route)).status, 403, route);
  }
  assert.equal((await raw(runtime.origin, '/__bridge/health', { ...headers, Host: `127.0.0.1:${DEFAULT_PORT}` })).status, 403);
  assert.equal((await raw(runtime.origin, '/__bridge/health', { ...headers, Origin: active[1].origin })).status, 403);
  assert.equal((await raw(runtime.origin, '/__bridge/health', { ...headers, Origin: runtime.origin })).status, 200);
  const response = await fetch(runtime.origin + '/');
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
  // The panel opt-in admits only a framed GET/HEAD document navigation. Every other cross-site
  // shape, and every API or bridge route even when framed, is still refused.
  const framed = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' };
  assert.equal((await raw(runtime.origin, '/?photoshop=cep', framed)).status, 200);
  for (const [route, extra] of [
    ['/', { 'Sec-Fetch-Site': 'cross-site' }],
    ['/', { ...framed, 'Sec-Fetch-Dest': 'document' }],
    ['/', { ...framed, 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'script' }],
    ['/api/fonts', { ...framed, ...headers }],
    ['/%61pi/fonts', { ...framed, ...headers }],
    ['/__bridge/health', { ...framed }],
  ]) assert.equal((await raw(runtime.origin, route, extra)).status, 403, `${route} ${JSON.stringify(extra)}`);
});

test('explicit occupied port still fails and explicit zero selects a fetch-compatible high port', async t => {
  await assert.rejects(startEditor({ ...options(), port: blockerPort }), { code: 'EADDRINUSE' });
  assert.equal(await (await fetch(`http://127.0.0.1:${blockerPort}/`)).text(), 'blocked');
  // The default port is never silently ignored when the caller names it, whatever the OS says.
  await assert.rejects(startEditor({ ...options(), port: DEFAULT_PORT }), { code: defaultPortOwned ? 'EADDRINUSE' : 'EACCES' });
  const runtime = await startEditor({ ...options(), port: 0 });
  active.push(runtime);
  t.diagnostic(`Explicit zero: ${highPort(runtime)}`);
  assert.equal((await fetch(runtime.origin + '/__bridge/health', { headers })).status, 200);
});

test('real Chromium iframe loads the editor through the occupied-default fallback', async t => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', req => failures.push(`${req.url()}: ${req.failure()?.errorText}`));
    const loaded = page.waitForEvent('framenavigated', { predicate: frame => frame.url().startsWith(active[0].origin + '/') });
    await page.goto(`http://127.0.0.1:${ownerPort}/frame`);
    const frame = await loaded;
    await frame.waitForFunction(() => document.querySelector('[data-testid="state-marker"]')?.dataset.loading === 'false', null, { timeout: 30000 });
    assert.ok(await frame.locator('#root').count());
    assert.ok((await frame.locator('.brand').innerText()).includes('字造'));
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    t.diagnostic(`Edge ${browser.version()} loaded ${frame.url().split('#')[0]} in a real iframe`);
  } finally { await browser.close(); }
});

// The CEP panel page is a file:// document, so its iframe navigation to the local editor arrives
// as Sec-Fetch-Site: cross-site with no Origin. The http:// owner page above is same-site and
// never exercised that path, which is how a 403 "拦截外站请求" shipped inside the panel.
test('real Chromium iframe from a file:// panel page loads the editor (CEP host shape)', async t => {
  const runtime = active[0];
  const panelPage = path.join(directory, 'cep-panel.html');
  await writeFile(panelPage, `<!doctype html><meta charset="utf-8"><iframe src="${runtime.origin}/?photoshop=cep#zizao-token=${token}" style="width:1200px;height:800px;border:0"></iframe>`);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], failures = [], documents = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', req => failures.push(`${req.url()}: ${req.failure()?.errorText}`));
    page.on('response', async response => {
      if (response.request().resourceType() !== 'document' || !response.url().startsWith(runtime.origin)) return;
      documents.push({ status: response.status(), site: (await response.request().allHeaders())['sec-fetch-site'] });
    });
    const loaded = page.waitForEvent('framenavigated', { predicate: frame => frame.url().startsWith(runtime.origin + '/') });
    await page.goto(pathToFileURL(panelPage).href);
    const frame = await loaded;
    await frame.waitForLoadState('domcontentloaded');
    assert.ok(!(await frame.content()).includes('拦截外站请求'), 'editor document must not be rejected as cross-site');
    assert.deepEqual(documents.map(item => item.status), [200]);
    assert.equal(documents[0].site, 'cross-site', 'the browser must report this navigation as cross-site, matching CEP');
    await frame.waitForFunction(() => document.querySelector('[data-testid="state-marker"]')?.dataset.loading === 'false', null, { timeout: 30000 });
    assert.ok((await frame.locator('.brand').innerText()).includes('字造'));
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    t.diagnostic(`Edge ${browser.version()} loaded the editor from a file:// parent (Sec-Fetch-Site=${documents[0].site})`);
  } finally { await browser.close(); }
});
