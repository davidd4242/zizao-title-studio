import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, timeout, fallback) => {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeout); })]).finally(() => clearTimeout(timer));
};
const until = async (read, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(25);
  }
  throw new Error(label);
};
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
async function connectInspector(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data), task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Inspector closed')); }
    pending.clear();
  });
  return {
    close: () => socket.close(),
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    }),
  };
}
export async function launchObservedPortable({ executablePath, profile, out, env, timeout = 120000 }) {
  await mkdir(out, { recursive: true });
  const native = path.join(out, 'native');
  await mkdir(native, { recursive: true });
  const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const monitor = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'probe-portable-startup-windows.ps1'), '-OutDir', native], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let monitorLog = '', applicationLog = '', child, bridge, browser, exited, startedAt;
  monitor.stdout.on('data', bytes => { monitorLog += bytes; });
  monitor.stderr.on('data', bytes => { monitorLog += bytes; });
  const monitorExit = new Promise(resolve => { monitor.once('exit', code => resolve(code)); monitor.once('error', error => resolve(error.message)); });
  const stopMonitor = async () => {
    await writeFile(path.join(native, 'stop'), 'stop');
    const result = await withTimeout(monitorExit, 7000, 'timeout');
    if (result === 'timeout') { monitor.kill(); await monitorExit; }
    await writeFile(path.join(out, 'native-monitor.log'), monitorLog);
    return result;
  };
  const stopChild = async () => {
    if (child?.pid && child.exitCode === null) await new Promise((resolve, reject) => {
      execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'probe-portable-startup-windows.ps1'), '-OutDir', native, '-CleanupPid', String(child.pid), '-ExpectedPath', executablePath, '-StartedAt', String(startedAt)], { windowsHide: true }, (error, stdout, stderr) => {
        monitorLog += stdout + stderr;
        if (error) reject(error); else resolve();
      });
    });
  };
  try {
    await until(async () => {
      if (monitor.exitCode !== null) throw new Error(`Native monitor exited: ${monitorLog}`);
      return readFile(path.join(native, 'ready'), 'utf8').catch(() => false);
    }, 'Native monitor did not become ready', 20000);
    const mainPort = await port(), browserPort = await port();
    startedAt = Date.now();
    child = spawn(executablePath, [`--user-data-dir=${profile}`, `--inspect=${mainPort}`, `--remote-debugging-port=${browserPort}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    exited.catch(() => {});
    child.stdout.on('data', bytes => { applicationLog += bytes; });
    child.stderr.on('data', bytes => { applicationLog += bytes; });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await writeFile(path.join(native, 'launch.tmp'), JSON.stringify({ pid: child.pid, path: executablePath, startedAt }));
    await rename(path.join(native, 'launch.tmp'), path.join(native, 'launch.json'));
    const getDebugger = async endpoint => {
      if (child.exitCode !== null) throw new Error(`Portable launcher exited (${child.exitCode}): ${applicationLog}`);
      try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) }); if (response.ok) return response.json(); } catch {}
      return false;
    };
    const contexts = await until(() => getDebugger(`http://127.0.0.1:${mainPort}/json/list`), 'Main inspector was not ready', timeout);
    bridge = await connectInspector(contexts[0].webSocketDebuggerUrl);
    const evaluate = async (fn, argument) => {
      const expression = `(${fn.toString()})(process.mainModule.require('electron'), ${JSON.stringify(argument) ?? 'undefined'})`;
      const response = await bridge.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    await evaluate(({ app, BrowserWindow }, folder) => {
      const fs = process.mainModule.require('node:fs/promises');
      const path = process.mainModule.require('node:path');
      const record = { attachedAt: Date.now(), events: [], snapshots: [], errors: [] };
      globalThis.__portableStartupObservation = record;
      let index = 0;
      const observe = win => {
        const handle = win.getNativeWindowHandle();
        const hwnd = Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE());
        const event = kind => record.events.push({ kind, at: Date.now(), id: win.id, hwnd, visible: win.isVisible(), url: win.webContents.getURL() });
        const snapshot = async kind => {
          if (win.isDestroyed()) return;
          event(kind);
          const entry = { kind, at: Date.now(), id: win.id, hwnd, visible: win.isVisible(), url: win.webContents.getURL() };
          try {
            entry.document = await win.webContents.executeJavaScript(`({ title:document.title, text:document.body?.innerText?.slice(0,12000), loading:document.querySelector('[data-testid="state-marker"]')?.dataset.loading, blurred:[...document.querySelectorAll('.workbench,.app,.app-shell,.workspace')].some(e=>getComputedStyle(e).filter.includes('blur')) })`);
            const filename = `renderer-${String(index++).padStart(2, '0')}.png`;
            const image = await win.webContents.capturePage();
            await fs.writeFile(path.join(folder, filename), image.toPNG());
            entry.file = filename;
            record.snapshots.push(entry);
          } catch (error) { record.errors.push(String(error)); }
        };
        event('observed-window');
        win.on('show', () => event('show'));
        win.webContents.on('dom-ready', () => { void snapshot('dom-ready'); });
        win.webContents.on('did-finish-load', () => { void snapshot('did-finish-load'); });
        if (win.webContents.getURL()) void snapshot('attached-document');
      };
      app.on('browser-window-created', (_event, win) => observe(win));
      BrowserWindow.getAllWindows().forEach(observe);
      return { attachedAt: record.attachedAt, windows: BrowserWindow.getAllWindows().length };
    }, out);
    await until(() => getDebugger(`http://127.0.0.1:${browserPort}/json/version`), 'Browser debugger was not ready', timeout);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 30000 });
    let closed = false;
    return {
      page, evaluate, startedAt, launcherPid: child.pid, native, out,
      observation: () => evaluate(() => globalThis.__portableStartupObservation),
      stopNative: stopMonitor,
      close: async () => {
        if (closed) return;
        closed = true;
        await evaluate(({ app }) => { setImmediate(() => app.quit()); return true; }).catch(() => {});
        bridge.close(); await browser.close().catch(() => {});
        const result = await withTimeout(exited, 20000, null);
        try { if (!result) await stopChild(); }
        finally {
          await stopMonitor();
          await writeFile(path.join(out, 'application.log'), applicationLog);
        }
        if (!result || result.code !== 0) throw new Error(`Portable exit was not clean: ${JSON.stringify(result)}`);
        return result;
      },
    };
  } catch (error) {
    bridge?.close(); await browser?.close().catch(() => {});
    try { await stopChild(); }
    catch (cleanupError) { applicationLog += `\nCleanup: ${cleanupError.stack || cleanupError}\n`; }
    finally { await stopMonitor(); }
    await writeFile(path.join(out, 'application.log'), applicationLog);
    throw error;
  }
}
