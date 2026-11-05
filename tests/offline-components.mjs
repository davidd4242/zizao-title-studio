import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readPsd } from 'ag-psd';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argument = name => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
const mode = argv.includes('--final') ? 'final' : 'baseline';
const releaseRecord = argument('--ps-record');
const requestedVersion = argument('--version');
const executable = argument('--exe');
const out = path.resolve(argument('--out') || path.join(root, 'verification/offline-components', `${mode}-${Date.now()}`));
assert.ok(out.startsWith(path.join(root, 'verification/offline-components') + path.sep), 'Artifacts stay in the owned verification directory');
if (mode === 'final') {
  assert.ok(argv.includes('--final-offline-build-ready'), 'Final execution requires the Lead build-ready signal');
  assert.ok(releaseRecord && requestedVersion && executable, 'Final execution needs exact PS record, EXE and version');
}
assert.ok(releaseRecord, 'Pass an explicit --ps-record; latest is deliberately not used');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { mode, startedAt: new Date().toISOString(), checks: [], artifacts: [], runtimeRequests: [], blocked: [], browserErrors: [], limitations: [
  'Edge runs the actual built editor and actual packaged Photoshop editor. This does not claim that CEP was mounted inside Photoshop.',
  'Photoshop still needs an installed compatible Adobe host. The independent EXE does not need Photoshop or a system Node installation.',
  'The EXE is fingerprinted here; final native Electron checks are run separately by the Lead with tests/desktop.mjs.',
  'The test blocks browser HTTP/HTTPS/WS/WSS and DNS resolution, and Node TCP/DNS/UDP APIs in the child runtime and font workers. It does not change adapters, system DNS or the firewall.',
  'Optional reference-site links and license/document URLs are not runtime dependencies. They are inventoried but are not followed.',
] };
const check = (name, condition, detail) => {
  assert.ok(condition, detail ? `${name}: ${JSON.stringify(detail)}` : name);
  report.checks.push({ name, ...(detail === undefined ? {} : { detail }) });
  console.log(`PASS ${name}`);
};
await mkdir(out, { recursive: true });

// This preload only denies network egress; the fonts, server, browser and exporters remain real.
function installNetworkGuard() {
  const fs = require('node:fs');
  const path = require('node:path');
  const net = require('node:net');
  const dns = require('node:dns');
  const dgram = require('node:dgram');
  const threads = require('node:worker_threads');
  const { syncBuiltinESMExports } = require('node:module');
  const destination = process.env.ZIZAO_OFFLINE_LOG;
  if (!destination) throw new Error('Offline guard needs an evidence log');
  const log = value => fs.appendFileSync(destination, JSON.stringify({ at: Date.now(), pid: process.pid, threadId: threads.threadId, ...value }) + '\n');
  const local = value => ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(String(value).toLowerCase());
  const deny = (kind, target) => { log({ event: 'blocked', kind, target: String(target) }); const error = new Error(`OFFLINE_GUARD ${kind} ${target}`); error.code = 'ERR_OFFLINE_GUARD'; throw error; };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first && typeof first === 'object' && first.path) {
      if (!String(first.path).startsWith('\\\\.\\pipe\\')) deny('named-pipe', first.path);
    } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
      if (!first.startsWith('\\\\.\\pipe\\')) deny('socket', first);
    } else {
      const host = typeof first === 'object' ? first.host || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
      if (!local(host)) deny('tcp', host);
    }
    return connect.apply(this, args);
  };
  for (const target of [dns, dns.promises]) {
    for (const key of Object.keys(target)) {
      if (!/^(lookup|resolve|reverse)/.test(key) || typeof target[key] !== 'function') continue;
      const original = target[key];
      target[key] = function (hostname, ...args) {
        if (key !== 'lookup' || !local(hostname)) deny(`dns.${key}`, hostname);
        return original.call(this, hostname, ...args);
      };
    }
  }
  for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
    for (const key of Object.getOwnPropertyNames(Resolver.prototype)) {
      if (/^(resolve|reverse)/.test(key)) Resolver.prototype[key] = function (hostname) { deny(`resolver.${key}`, hostname); };
    }
  }
  dgram.Socket.prototype.send = function () { deny('udp', 'datagram'); };
  const Worker = threads.Worker;
  threads.Worker = class extends Worker {
    constructor(filename, options = {}) {
      const execArgv = [...(options.execArgv || process.execArgv)];
      if (!execArgv.includes(__filename)) execArgv.push('--require', __filename);
      super(filename, { ...options, execArgv });
    }
  };
  syncBuiltinESMExports();
  log({ event: 'armed', entry: process.argv[1], preload: path.resolve(__filename) });
}
const guard = path.join(out, 'network-guard.cjs');
await writeFile(guard, `(${installNetworkGuard.toString()})();\n`);
const guardLog = path.join(out, 'node-network.jsonl');
const processes = [];
async function startChild(exe, args, env = {}) {
  const child = spawn(exe, ['--require', guard, ...args], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', ELECTRON_RUN_AS_NODE: '', ZIZAO_OFFLINE_LOG: guardLog, ...env } });
  const log = { pid: child.pid, exe, args, stdout: '', stderr: '', exited: false, closed: false };
  processes.push({ child, log });
  child.stdout?.on('data', value => { log.stdout += value; });
  child.stderr?.on('data', value => { log.stderr += value; });
  child.on('exit', (code, signal) => { log.exited = true; log.code = code; log.signal = signal; });
  child.on('close', (code, signal) => { log.closed = true; log.code = code; log.signal = signal; });
  child.on('error', error => { log.spawnError = error.message; });
  return child;
}
async function waitLine(child, pattern, timeout = 30000) {
  const entry = processes.find(item => item.child === child);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Child readiness timeout: ${entry.log.stderr}\n${entry.log.stdout}`)), timeout);
    const scan = () => { for (const line of entry.log.stdout.split(/\r?\n/)) { const match = line.match(pattern); if (match) return finish(null, match); } };
    const failed = error => finish(error);
    const closed = code => { scan(); if (!settled) finish(new Error(`Child closed ${code}: ${entry.log.spawnError || entry.log.stderr}`)); };
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer); child.stdout?.off('data', scan); child.off('error', failed); child.off('close', closed);
      error ? reject(error) : resolve(value);
    }
    child.stdout?.on('data', scan); child.once('error', failed); child.once('close', closed);
    scan();
    if (entry.log.spawnError) failed(new Error(entry.log.spawnError));
    else if (entry.log.closed || child.exitCode !== null || child.signalCode !== null) closed(child.exitCode);
  });
}
async function stopChild(child) {
  const entry = processes.find(item => item.child === child);
  if (!child.pid || entry?.log.closed || child.exitCode !== null || child.signalCode !== null) return child.exitCode ?? entry?.log.code ?? null;
  return await new Promise(resolve => {
    let settled = false;
    const soft = setTimeout(() => child.kill(), 3000);
    const hard = setTimeout(() => {
      entry.log.cleanupTimedOut = true;
      child.kill('SIGKILL');
      child.unref(); child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
      finish(child.exitCode);
    }, 6000);
    function finish(code) { if (settled) return; settled = true; clearTimeout(soft); clearTimeout(hard); child.off('close', finish); resolve(code); }
    child.once('close', finish);
    child.stdin?.end();
    if (entry.log.closed) finish(entry.log.code);
  });
}
async function filesUnder(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesUnder(file));
    else if (item.isFile()) result.push(file);
    else assert.fail(`Unexpected non-regular path in verification input: ${file}`);
  }
  return result;
}
async function verifyPackageIdentity(pkg) {
  const archive = await readFile(pkg.zip);
  assert.equal(archive.length, pkg.zipBytes, 'Frozen ZIP byte length');
  assert.equal(sha(archive), pkg.sha256, 'Frozen ZIP SHA256');
  const zipEntries = [];
  const anchors = unzipSync(archive, { filter: entry => {
    zipEntries.push({ name: entry.name, size: entry.originalSize });
    return /\/com\.zizao\.title-studio\/(?:package-manifest|build-evidence)\.json$/.test(entry.name);
  } });
  const manifests = Object.keys(anchors).filter(name => name.endsWith('/package-manifest.json'));
  assert.equal(manifests.length, 1, 'Exactly one package manifest in frozen ZIP');
  const prefix = manifests[0].slice(0, -'package-manifest.json'.length);
  const manifestBytes = Buffer.from(anchors[manifests[0]]);
  assert.deepEqual(await readFile(path.join(pkg.extension, 'package-manifest.json')), manifestBytes, 'Actual manifest equals frozen ZIP manifest');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.name, 'com.zizao.title-studio');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.node, pkg.runtime);
  const names = manifest.files.map(item => item.file);
  for (const name of names) assert.ok(!name.startsWith('/') && !/[\\:\x00-\x1f]/.test(name) && !name.split('/').some(part => part === '..' || part === ''), `Manifest path stays inside extension: ${name}`);
  assert.equal(new Set(names).size, names.length, 'Manifest has unique file paths');
  assert.equal(names.length, pkg.files, 'Release file count equals frozen manifest');
  const expected = [...names, 'package-manifest.json'].sort();
  const actual = (await filesUnder(pkg.extension)).map(file => path.relative(pkg.extension, file).split(path.sep).join('/')).sort();
  assert.deepEqual(actual, expected, 'Actual extension file set equals frozen manifest');
  const zipFiles = zipEntries.filter(item => item.name.startsWith(prefix) && !item.name.endsWith('/'));
  assert.deepEqual(zipFiles.map(item => item.name.slice(prefix.length)).sort(), expected, 'Frozen ZIP file set equals frozen manifest');
  const zipSizes = new Map(zipFiles.map(item => [item.name.slice(prefix.length), item.size]));
  for (const item of manifest.files) {
    assert.equal(zipSizes.get(item.file), item.size, `ZIP entry size: ${item.file}`);
    const bytes = await readFile(path.join(pkg.extension, item.file));
    assert.equal(bytes.length, item.size, `Actual extension size: ${item.file}`);
    assert.equal(sha(bytes), item.sha256, `Actual extension SHA256: ${item.file}`);
  }
  const evidenceBytes = await readFile(path.join(pkg.extension, 'build-evidence.json'));
  assert.deepEqual(evidenceBytes, Buffer.from(anchors[prefix + 'build-evidence.json']), 'Actual build evidence equals frozen ZIP evidence');
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.version, pkg.version);
  assert.equal(evidence.sourceSha256, pkg.sourceSha256, 'Frozen source fingerprint');
  assert.equal(evidence.mainDist.sha256, pkg.mainDistSha256, 'Frozen main dist fingerprint');
  assert.equal(evidence.editorDist.sha256, pkg.editorDistSha256, 'Frozen PS dist fingerprint');
  return { manifest, evidence, verifiedFiles: expected.length };
}
async function auditFiles(extension) {
  const files = [path.join(root, 'desktop/main.cjs'), ...await filesUnder(path.join(root, 'src')), ...['index.mjs', 'font-worker.mjs', 'outline.mjs'].map(name => path.join(root, 'server', name)), ...['panel/index.html', 'panel/panel.js', 'panel/host.cjs', 'runtime/server.mjs', 'client.ts', 'jsx/import.jsx'].map(name => path.join(root, 'photoshop', name))];
  const sources = [];
  for (const file of files) {
    const bytes = await readFile(file), text = bytes.toString('utf8');
    const references = [...new Set(text.match(/https?:\/\/[^\s"'<>`)]+/g) || [])];
    const dynamicResources = /(?:import\s*\(\s*|from\s*|(?:src|href)\s*=\s*)["']https?:\/\//g;
    const executableRemote = [...text.matchAll(dynamicResources)].map(match => match[0]).filter(value => !value.startsWith('href='));
    check(`No remote executable resource: ${path.relative(root, file)}`, executableRemote.length === 0, executableRemote);
    sources.push({ file, sha256: sha(bytes), references: references.map(url => ({ url, kind: /w3\.org/.test(url) ? 'XML namespace' : /127\.0\.0\.1|localhost/.test(url) ? 'loopback' : /sozaino\.site|pinterest\.com/.test(url) ? 'optional user-opened reference link' : 'manual review reference' })) });
  }
  const main = await readFile(path.join(root, 'desktop/main.cjs'), 'utf8');
  check('Native renderer blocks HTTP, HTTPS, WS and WSS requests', main.includes("['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']") && main.includes('cancel: true'));
  check('Native zizao handler targets a fixed loopback origin', main.includes('http://127.0.0.1:${server.address().port}') && main.includes('fetch(`${localOrigin}${url.pathname}${url.search}`'));
  for (const [file, pattern] of [['panel/index.html', /frame-src http:\/\/127\.0\.0\.1:\*; connect-src http:\/\/127\.0\.0\.1:\*/], ['runtime/server.mjs', /connect-src 'self'/]]) {
    const bytes = await readFile(path.join(extension, file));
    check(`Actual PS package restricts external connections: ${file}`, pattern.test(bytes.toString()));
    sources.push({ file: path.join(extension, file), sha256: sha(bytes) });
  }
  await writeFile(path.join(out, 'source-audit.json'), JSON.stringify({ sources, findings: [
    'Font discovery reads local filesystem, bundled files and Windows registry. Fontkit shaping has no network input.',
    'Browser exporters create local SVG/Canvas/Blob/PSD/ZIP data. Algorithm and vector catalogs are compiled local code.',
    'Desktop uses bundled Electron and Node capabilities. PS uses its bundled runtime/node.exe and dependency closure.',
    'PS bridge transfers ArrayBuffers over MessageChannel, then stages a local PSD for ExtendScript app.open(). Adobe document operations are not run by this test.',
    'Documentation, font licenses and package metadata may contain URLs; these are not fetched at runtime.',
  ] }, null, 2));
}

let browser, proxy, parent, webChild, psChild;
let phase = 'setup';
const allowedOrigins = new Set();
const allowedUrl = value => {
  try { const url = new URL(value); return ['data:', 'blob:', 'file:', 'about:'].includes(url.protocol) || allowedOrigins.has(url.origin); } catch { return false; }
};
const violation = (kind, url) => { const item = { at: Date.now(), phase, kind, url }; report.blocked.push(item); return item; };
const networkEvents = [];
try {
  const recordPath = path.resolve(releaseRecord);
  const pkg = JSON.parse(await readFile(recordPath, 'utf8'));
  const extension = pkg.extension;
  const { manifest: pkgManifest, evidence, verifiedFiles } = await verifyPackageIdentity(pkg);
  check('Actual PS extension files match the frozen ZIP manifest and build evidence', true, { files: verifiedFiles, sha256: pkg.sha256 });
  check('Explicit PS release record matches its package manifest', pkg.version === pkgManifest.version);
  if (mode === 'final') check('Frozen package has the requested final version', pkg.version === requestedVersion);
  report.package = { record: recordPath, version: pkg.version, extension, runtime: pkg.runtime, zip: pkg.zip, sha256: pkg.sha256, verifiedFiles };
  report.buildEvidence = { sourceSha256: evidence.sourceSha256, mainDistSha256: evidence.mainDist.sha256, editorDistSha256: evidence.editorDist.sha256 };
  if (mode === 'final') {
    const mainPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    check('Main package, PS package and requested version are identical', mainPackage.version === pkg.version && pkg.version === requestedVersion);
    const actualFiles = (await filesUnder(path.join(root, 'dist'))).map(file => path.relative(path.join(root, 'dist'), file).split(path.sep).join('/')).sort();
    assert.deepEqual(actualFiles, evidence.mainDist.files.map(item => item.file).sort(), 'Frozen main dist file set');
    for (const item of evidence.mainDist.files) {
      const bytes = await readFile(path.join(root, 'dist', item.file));
      assert.equal(bytes.length, item.size, item.file);
      assert.equal(sha(bytes), item.sha256, item.file);
    }
    check('Final main dist matches the PS release evidence byte for byte', true, { files: actualFiles.length, sha256: evidence.mainDist.sha256 });
    for (const name of ['index.mjs', 'font-worker.mjs', 'outline.mjs']) {
      assert.deepEqual(await readFile(path.join(root, 'server', name)), await readFile(path.join(extension, 'packages/editor/server', name)), `Main server matches frozen package: ${name}`);
    }
    check('All main font service modules match the frozen PS package byte for byte', true);
  }
  if (executable) { const bytes = await readFile(path.resolve(executable)); report.exe = { path: path.resolve(executable), size: bytes.length, sha256: sha(bytes), nativeRuntimeChecks: 'Lead-owned tests/desktop.mjs; not repeated here' }; }
  await auditFiles(extension);

  const canaryEntry = path.join(out, 'guard-canary.mjs');
  await writeFile(canaryEntry, "import assert from 'node:assert/strict'; import dns from 'node:dns'; import net from 'node:net'; import {Worker} from 'node:worker_threads'; for (const probe of [()=>dns.lookup('offline-canary.invalid',()=>{}),()=>dns.resolve4('offline-canary.invalid',()=>{}),()=>net.connect(443,'203.0.113.1')]) assert.throws(probe,{code:'ERR_OFFLINE_GUARD'}); const worker=new Worker(`const net=require('node:net');try{net.connect(443,'203.0.113.1');process.exit(2)}catch(e){if(e.code!=='ERR_OFFLINE_GUARD')throw e}`,{eval:true,execArgv:[]}); worker.on('exit',code=>{assert.equal(code,0);console.log('GUARD_CANARY_PASS')});\n");
  const canary = await startChild(process.execPath, [canaryEntry]);
  await waitLine(canary, /GUARD_CANARY_PASS/);
  if (canary.exitCode === null) await once(canary, 'exit');
  check('Node guard blocks DNS, literal external IP and worker egress before connection', canary.exitCode === 0);
  const canaryLines = (await readFile(guardLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  report.nodeCanaries = canaryLines;
  await writeFile(guardLog, '');

  const webEntry = path.join(out, 'web-runtime.mjs');
  await writeFile(webEntry, `import {start} from ${JSON.stringify(pathToFileURL(path.join(root, 'server/index.mjs')).href)}; const server=await start({port:0,staticDir:${JSON.stringify(path.join(root, 'dist'))},dataDir:${JSON.stringify(path.join(out, 'web-font-profile'))}}); console.log('OFFLINE_WEB_READY '+server.address().port); process.stdin.resume(); process.stdin.once('end',async()=>{await server.fontService.close();server.close(()=>process.exit(0));server.closeAllConnections()});\n`);
  webChild = await startChild(process.execPath, [webEntry]);
  const webReady = await waitLine(webChild, /OFFLINE_WEB_READY (\d+)/);
  const webOrigin = `http://127.0.0.1:${webReady[1]}`;
  allowedOrigins.add(webOrigin);
  const token = randomBytes(32).toString('hex');
  const system = process.env.SystemRoot || 'C:\\Windows';
  const cleanPath = `${system}\\System32;${system};${system}\\System32\\WindowsPowerShell\\v1.0`;
  psChild = await startChild(path.join(extension, 'runtime/node.exe'), [path.join(extension, 'runtime/server.mjs')], { Path: cleanPath, PATH: cleanPath, ZIZAO_TOKEN: token, ZIZAO_DATA_DIR: path.join(out, 'ps-font-profile'), ZIZAO_PARENT_PID: String(process.pid) });
  const psReady = await waitLine(psChild, /^(\{"type":"zizao:server-ready".*\})$/);
  const psOrigin = JSON.parse(psReady[1]).origin;
  assert.equal(new URL(psOrigin).hostname, '127.0.0.1');
  allowedOrigins.add(psOrigin);
  check('Real packaged Node starts without system Node on PATH', processes.find(item => item.child === psChild).log.exe === path.join(extension, 'runtime/node.exe'));

  for (const item of evidence.editorDist.files) {
    const response = await fetch(psOrigin + '/' + item.file);
    assert.equal(response.status, 200, item.file);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, item.size, item.file);
    assert.equal(sha(bytes), item.sha256, item.file);
  }
  check('Packaged server serves byte-exact Chrome99 output, including lazy chunks', evidence.target === 'chrome99', { files: evidence.editorDist.files.length });
  const psHeaders = { 'X-Zizao-Token': token };
  const psHtml = await fetch(psOrigin);
  report.effectivePsCsp = psHtml.headers.get('content-security-policy');
  check('Live PS editor response has self-only connect CSP', report.effectivePsCsp.includes("connect-src 'self'"));
  const health = await fetch(psOrigin + '/__bridge/health', { headers: psHeaders }).then(response => response.json());
  check('Bundled runtime version matches release record', health.runtime === pkg.runtime);
  const host = createRequire(import.meta.url)(path.join(extension, 'panel/host.cjs'));
  const received = [];
  const parentScript = `const frame=document.querySelector('iframe'),origin=${JSON.stringify(psOrigin)},token=${JSON.stringify(token)};addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==origin||event.data.type!=='zizao:connect'||event.data.version!==1||event.data.token!==token||event.ports.length!==1)return;const port=event.ports[0];port.onmessage=async({data})=>{try{const result=await window.inspectPsd({...data,bytes:Array.from(new Uint8Array(data.bytes))});port.postMessage({type:'zizao:result',version:1,token,requestId:data.requestId,ok:true,result})}catch(error){port.postMessage({type:'zizao:result',version:1,token,requestId:data.requestId,ok:false,error:String(error)})}};port.start();port.postMessage({type:'zizao:ready',version:1,token,capabilities:['layered-psd','new-document','insert-layers']})});frame.src=origin+'/?photoshop=cep#zizao-token='+token;`;
  parent = http.createServer((request, response) => { if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; } response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); response.end(`<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe></iframe><script>${parentScript}</script>`); });
  await new Promise(resolve => parent.listen(0, '127.0.0.1', resolve));
  const parentOrigin = `http://127.0.0.1:${parent.address().port}`;
  allowedOrigins.add(parentOrigin);

  proxy = http.createServer((request, response) => { violation('rejecting-proxy', request.url); response.writeHead(502, { Connection: 'close' }); response.end('Offline verification'); });
  proxy.on('connect', (request, socket) => { violation('rejecting-proxy-connect', request.url); socket.end('HTTP/1.1 502 Offline Verification\r\nConnection: close\r\n\r\n'); });
  proxy.on('upgrade', (request, socket) => { violation('rejecting-proxy-upgrade', request.url); socket.destroy(); });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const browserArgs = ['--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE [::1]', '--dns-prefetch-disable', '--disable-background-networking', '--disable-component-update', '--disable-quic', '--no-pings', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-features=DnsOverHttps,MediaRouter,OptimizationHints,msEdgeSidebarV2,msEdgePersonalization', `--proxy-server=http://127.0.0.1:${proxy.address().port}`, '--proxy-bypass-list=127.0.0.1;localhost;[::1]'];
  report.blocking = { browserArgs, proxy: 'Local sink; rejects rather than forwards HTTP, CONNECT and WebSocket upgrade', requestPolicy: 'Exact isolated loopback origins only; external HTTP/HTTPS/WS/WSS fail the run', nodePreload: guard, nodeLog: guardLog, networkSettingsChanged: false };
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: browserArgs });
  report.browser = await browser.version();
  async function contextFor(label) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!allowedUrl(url)) { violation(`${label}:route`, url); return route.abort('blockedbyclient'); }
      networkEvents.push({ label, method: route.request().method(), type: route.request().resourceType(), url: url.replace(/#.*$/, '') });
      return route.continue();
    });
    await context.routeWebSocket('**/*', route => { if (!allowedUrl(route.url())) { violation(`${label}:websocket`, route.url()); route.close({ code: 1008, reason: 'Offline verification' }); } else route.connectToServer(); });
    context.on('page', page => { page.on('pageerror', error => report.browserErrors.push({ label, message: error.message })); });
    return context;
  }
  phase = 'canary';
  const canaryContext = await contextFor('canary');
  const canaryPage = await canaryContext.newPage();
  await canaryPage.goto('data:text/html,<title>Offline guard canary</title>');
  const browserCanaries = await canaryPage.evaluate(async () => {
    const result = [];
    for (const url of ['http://offline-canary.invalid/probe', 'https://203.0.113.1/probe']) {
      try { await fetch(url); result.push(false); } catch { result.push(true); }
    }
    for (const url of ['ws://offline-canary.invalid/socket', 'wss://203.0.113.1/socket']) result.push(await new Promise(resolve => { const socket = new WebSocket(url); socket.onopen = () => { socket.close(); resolve(false); }; socket.onclose = () => resolve(true); socket.onerror = () => resolve(true); setTimeout(() => resolve(false), 3000); }));
    return result;
  });
  check('Browser canaries prove external HTTP, HTTPS, WS and WSS are blocked', browserCanaries.every(Boolean) && report.blocked.filter(item => item.phase === 'canary').length >= 4, browserCanaries);
  await canaryContext.close();
  phase = 'runtime';

  async function exercise(label, url, origin, headers = {}, photoshop = false) {
    const context = await contextFor(label);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    if (photoshop) await page.exposeFunction('inspectPsd', async message => {
      const item = host.validateMessage({ ...message, bytes: Uint8Array.from(message.bytes).buffer }, token);
      const psd = readPsd(item.bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
      const receipt = { mode: item.mode, name: item.name, bytes: item.bytes.length, sha256: sha(item.bytes), width: psd.width, height: psd.height, layers: psd.children.map(layer => layer.name), nativePhotoshopCalled: false };
      received.push(receipt);
      await writeFile(path.join(out, `${label}-bridge-${item.mode}.psd`), item.bytes);
      return { documentName: item.name, layerCount: psd.children.length };
    });
    await page.goto(url);
    if (photoshop) await page.waitForFunction(value => [...document.querySelectorAll('iframe')].some(frame => frame.src.startsWith(value)), origin);
    let frame = photoshop ? page.frames().find(item => item.url().startsWith(origin)) || await page.waitForEvent('framenavigated', { predicate: item => item.url().startsWith(origin) }) : page;
    const settle = async () => { await frame.waitForFunction(() => { const marker = document.querySelector('[data-testid="state-marker"]'); return marker?.dataset.loading === 'false' && marker.dataset.dirty === 'false' && !marker.dataset.busy; }, null, { timeout: 90000 }); await page.waitForTimeout(600); };
    const project = () => frame.evaluate(() => JSON.parse(localStorage.getItem('cover-type-studio-v1')));
    await settle();
    check(`${label}: actual built editor boots without remote assets`, await frame.getByTestId('startup-overlay').count() === 0);
    const catalog = await frame.evaluate(async ({ headers }) => { const response = await fetch('/api/fonts', { headers }); if (!response.ok) throw new Error(await response.text()); return response.json(); }, { headers });
    check(`${label}: all 55 bundled font faces are present`, catalog.fonts.filter(font => font.bundled).length === 55);
    const local = catalog.fonts.find(font => !font.bundled && font.hasChinese);
    assert.ok(local, 'Real Windows Chinese font exists');
    const samples = [...catalog.fonts.filter(font => font.bundled), local];
    const fontResults = await frame.evaluate(async ({ samples, headers }) => {
      const results = [];
      for (const font of samples) {
        const text = font.hasChinese ? font.languages?.includes('zh-Hant') ? '字造標題' : '中文标题' : 'Title';
        const response = await fetch('/api/outline', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fontId: font.id, text, fontSize: 100, letterSpacing: 2, lineHeight: 1.2, layout: 'horizontal', align: 'left' }) });
        const outline = await response.json();
        results.push({ font: font.fullName, id: font.id, bundled: !!font.bundled, text, status: response.status, glyphs: outline.glyphs?.length, commands: outline.glyphs?.reduce((n, glyph) => n + glyph.commands.length, 0), missing: outline.missing, valid: !!outline.glyphs?.every(glyph => glyph.commands.length > 0 && glyph.commands.every(command => Object.values(command).every(value => typeof value !== 'number' || Number.isFinite(value)))) });
      }
      return results;
    }, { samples, headers });
    check(`${label}: every bundled face plus local Chinese font generates real offline paths`, fontResults.length === 56 && fontResults.every(item => item.status === 200 && item.valid && item.commands > 0 && item.missing.length === 0), fontResults.filter(item => !item.valid || item.missing?.length));
    await writeFile(path.join(out, `${label}-fonts.json`), JSON.stringify({ fonts: fontResults, catalogCount: catalog.fonts.length, notices: catalog.errors }, null, 2));
    await frame.getByLabel('标题文字', { exact: true }).fill('离线字造 Title');
    await settle();
    check(`${label}: user-entered Chinese and English update embedded outline`, (await project()).layers.at(-1).text === '离线字造 Title');
    await frame.getByLabel('工程名称', { exact: true }).fill(`离线验收-${label}`);
    await settle();
    const algorithmSummary = frame.locator('.property-section > summary').filter({ hasText: /花体.*哥特|字形算法/ });
    const algorithms = [];
    if (await algorithmSummary.count()) {
      await algorithmSummary.first().click();
      for (const category of [/花体.*5/, /哥特.*5/]) {
        await frame.getByRole('button', { name: category }).click();
        const ids = await frame.locator('[data-letterform-id]').evaluateAll(buttons => buttons.map(button => button.dataset.letterformId));
        for (const id of ids) {
          await frame.locator(`[data-letterform-id="${id}"]`).click();
          await settle();
          const layer = (await project()).layers.at(-1);
          algorithms.push({ id, actual: layer.letterform?.presetId, commands: layer.glyphs.reduce((n, glyph) => n + glyph.commands.length, 0), kind: layer.kind, hash: sha(JSON.stringify(layer.glyphs)) });
        }
      }
      check(`${label}: ten compiled letterform algorithms run offline and persist real paths`, algorithms.length === 10 && new Set(algorithms.map(item => item.id)).size === 10 && algorithms.every(item => item.actual === item.id && item.kind === 'path' && item.commands > 0));
    } else if (mode === 'final') assert.fail(`${label}: final build lacks letterform controls`);
    else report.limitations.push(`${label}: baseline has no letterform controls; final build must include all ten algorithms.`);
    check(`${label}: 200 local style presets are available`, /200/.test(await frame.getByTestId('catalog-total').innerText()));
    await frame.locator('.preset-card').nth(2).click(); await settle();
    await frame.locator('.rail').getByRole('button', { name: '装饰', exact: true }).click();
    check(`${label}: 400 local vector decorations are available`, /400/.test(await frame.getByTestId('catalog-total').innerText()));
    const categories = await frame.getByLabel('装饰分类', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    const chosen = [...new Set([categories[0], categories[Math.floor(categories.length / 2)], categories.at(-1)])];
    const decorations = [];
    for (const category of chosen) {
      await frame.getByLabel('装饰分类', { exact: true }).selectOption(category);
      const card = frame.locator('.sticker-card').first();
      const geometry = await card.evaluate(button => ({ id: button.dataset.stickerId, paths: button.querySelectorAll('svg path').length, name: button.getAttribute('aria-label') }));
      assert.ok(geometry.paths > 0);
      await card.click(); await settle();
      const layer = (await project()).layers.at(-1);
      assert.ok(layer.kind === 'sticker' && layer.glyphs.some(glyph => glyph.commands.length));
      decorations.push({ ...geometry, category });
    }
    check(`${label}: selected cross-category decorations render and insert real geometry`, decorations.length === 3);
    const snapshot = await project();
    const saveDownload = async (button, filename) => { const pending = page.waitForEvent('download', { timeout: 60000 }); await button.click(); const download = await pending; assert.equal(await download.failure(), null); const file = path.join(out, filename); await download.saveAs(file); return file; };
    const openExport = async () => { await frame.locator('.header-actions').getByRole('button', { name: '导出标题', exact: true }).click(); await frame.getByLabel('输出精度', { exact: true }).selectOption('1'); await frame.getByLabel('导出范围', { exact: true }).selectOption('canvas'); };
    await openExport();
    const pngFile = await saveDownload(frame.getByTestId('download-png'), `${label}.png`); await settle();
    const png = await sharp(pngFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let clear = 0, visible = 0;
    for (let index = 3; index < png.data.length; index += 4) { if (!png.data[index]) clear++; else visible++; }
    check(`${label}: transparent PNG export is local and contains real artwork`, clear > 1000 && visible > 1000 && png.info.width === snapshot.width && png.info.height === snapshot.height);
    await openExport();
    const svgFile = await saveDownload(frame.getByRole('button', { name: '矢量 SVG', exact: true }), `${label}.svg`); await settle();
    const svg = await readFile(svgFile, 'utf8');
    check(`${label}: SVG is self-contained local geometry`, svg.includes('<path') && !/<(?:script|foreignObject)|(?:href|src)=["']https?:/i.test(svg));
    await openExport();
    const psdFile = await saveDownload(frame.getByTestId('download-psd'), `${label}.psd`); await settle();
    const psd = readPsd(await readFile(psdFile), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    check(`${label}: PSD exports full independent layers without a service`, psd.children.length === snapshot.layers.length && psd.width === snapshot.width && psd.height === snapshot.height);
    await openExport();
    await frame.getByLabel('PNG导出方式', { exact: true }).selectOption('layers');
    const zipFile = await saveDownload(frame.getByTestId('download-png'), `${label}-layers.zip`); await settle();
    const entries = unzipSync(await readFile(zipFile));
    const zipPngs = [];
    for (const [name, bytes] of Object.entries(entries)) { assert.match(name, /^\d{3}-[^/\\]+\.png$/); const info = await sharp(bytes).metadata(); zipPngs.push({ name, width: info.width, height: info.height, alpha: info.hasAlpha }); }
    check(`${label}: per-layer PNG ZIP contains every visible layer at common canvas size`, zipPngs.length === snapshot.layers.filter(layer => layer.visible).length && zipPngs.every(item => item.width === snapshot.width && item.height === snapshot.height && item.alpha));
    if (photoshop) {
      for (const [bridgeMode, button] of [['new-document', '送入 PS 新文档'], ['insert-layers', '插入当前 PS 文档']]) {
        await openExport(); await frame.getByRole('button', { name: button, exact: true }).click(); await settle();
        check(`${label}: real PSD MessageChannel payload validates for ${bridgeMode}`, received.some(item => item.mode === bridgeMode && item.layers.length === snapshot.layers.length));
      }
    }
    const projectFile = await saveDownload(frame.locator('.header-actions').getByRole('button', { name: '保存工程', exact: true }), `${label}.zizao.json`);
    const saved = JSON.parse(await readFile(projectFile, 'utf8'));
    check(`${label}: saved project preserves exact embedded paths and assets`, JSON.stringify(saved) === JSON.stringify(snapshot));
    await frame.getByRole('button', { name: '新建空白工程', exact: true }).click(); await settle();
    assert.equal((await project()).layers.length, 0);
    await frame.locator('input[type=file][accept=".json"]').setInputFiles(projectFile); await settle();
    check(`${label}: saved project reopens offline without lost geometry`, JSON.stringify(await project()) === JSON.stringify(snapshot));
    await page.reload();
    if (photoshop) {
      await page.waitForFunction(value => [...document.querySelectorAll('iframe')].some(element => element.src.startsWith(value)), origin);
      frame = page.frames().find(item => item.url().startsWith(origin)) || await page.waitForEvent('framenavigated', { predicate: item => item.url().startsWith(origin) });
    }
    await settle();
    check(`${label}: isolated-profile reload restores the project offline`, JSON.stringify(await project()) === JSON.stringify(snapshot));
    await page.screenshot({ path: path.join(out, `${label}-workbench.png`), fullPage: true });
    report.artifacts.push({ label, algorithms, decorations, exports: { png: pngFile, svg: svgFile, psd: psdFile, zip: zipFile, project: projectFile }, zipPngs, fonts: { total: catalog.fonts.length, bundled: 55, outlinesChecked: fontResults.length, notices: catalog.errors } });
    await context.close();
  }
  await exercise('built-editor', webOrigin, webOrigin);
  await exercise('ps-packaged-editor', parentOrigin, psOrigin, psHeaders, true);
  report.bridgeReceipts = received;
  const productEgress = report.blocked.filter(item => item.phase !== 'canary' && !item.kind.startsWith('rejecting-proxy'));
  report.browserBackgroundBlocked = report.blocked.filter(item => item.kind.startsWith('rejecting-proxy'));
  report.blocking.browserBackground = 'Edge browser-process requests reach the local rejecting proxy; each is recorded and rejected. They are separate from page/frame request routing. The proxy has no forwarding implementation.';
  check('Product page and frame HTTP/HTTPS/WebSocket requests stay on explicit loopback origins', productEgress.length === 0, productEgress);
  check('Built editors complete with zero uncaught browser errors', report.browserErrors.length === 0, report.browserErrors);
  await browser.close(); browser = undefined;
  const codes = [await stopChild(webChild), await stopChild(psChild)];
  check('Only owned test runtimes exit cleanly after their input pipe closes', codes.every(code => code === 0), codes);
  const nodeEvents = (await readFile(guardLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  report.nodeEvents = nodeEvents;
  for (const [label, child] of [['built-editor', webChild], ['ps-packaged-editor', psChild]]) {
    const armed = nodeEvents.filter(event => event.event === 'armed' && event.pid === child.pid);
    check(`${label}: guard preload is active in its main thread and actual font worker`, armed.some(event => event.threadId === 0) && armed.some(event => event.threadId > 0), { pid: child.pid, threads: armed.map(event => event.threadId) });
  }
  check('Real Node runtime and font workers attempt no external TCP, DNS or UDP', nodeEvents.every(event => event.event !== 'blocked'), nodeEvents.filter(event => event.event === 'blocked'));
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(error => { report.cleanupError = error.message; });
  for (const { child, log } of processes) if (!log.closed) await stopChild(child).catch(error => { report.cleanupError = error.message; });
  for (const server of [parent, proxy]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.finishedAt = new Date().toISOString();
  report.runtimeRequests = networkEvents;
  report.processes = processes.map(item => item.log);
  try { report.nodeEvents = (await readFile(guardLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch {}
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, mode, checks: report.checks.length, productEgress: report.blocked.filter(item => item.phase !== 'canary' && !item.kind.startsWith('rejecting-proxy')).length, browserBackgroundBlocked: report.blocked.filter(item => item.kind.startsWith('rejecting-proxy')).length, browserErrors: report.browserErrors.length, report: path.join(out, 'report.json') }));
}
