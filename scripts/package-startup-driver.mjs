import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, fallback) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
}
async function debuggerPorts() {
  const servers = [net.createServer(), net.createServer()];
  try {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))));
    return servers.map(server => server.address().port);
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
}
export function releaseOwnedHandles(child) {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.stdin?.destroy();
  child.unref();
}
async function connectInspector(url, logs) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Main inspector connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method) { logs.push({ at: Date.now(), ...message }); return; }
    const task = pending.get(message.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Main inspector closed')); } pending.clear(); });
  return {
    close: () => socket.close(),
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Main inspector request timed out: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    }),
  };
}
export async function launchMeasured({ executablePath, args, env, out, timeout = 150000 }) {
  await mkdir(out, { recursive: true });
  const [mainPort, browserPort] = await debuggerPorts();
  const startedAt = Date.now();
  const child = spawn(executablePath, [...args, `--inspect=${mainPort}`, `--remote-debugging-port=${browserPort}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const events = [], inspectorEvents = [];
  let stdout = '', stderr = '', spawnError, exitResult, bridge, browser, closed = false;
  const exit = new Promise(resolve => {
    child.once('error', error => { spawnError = error; exitResult = { error: error.message, at: Date.now() }; resolve(exitResult); });
    child.once('close', (code, signal) => { exitResult = { code, signal, at: Date.now() }; resolve(exitResult); });
  });
  child.stdout?.on('data', bytes => { stdout += bytes; }); child.stderr?.on('data', bytes => { stderr += bytes; });
  const save = async () => Promise.all([
    writeFile(path.join(out, 'application.stdout.log'), stdout), writeFile(path.join(out, 'application.stderr.log'), stderr),
    writeFile(path.join(out, 'driver.json'), JSON.stringify({ executablePath, startedAt, pid: child.pid, mainPort, browserPort, exit: exitResult, events, inspectorEvents }, null, 2)),
  ]);
  async function debuggerJson(endpoint) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exitResult || child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned launcher exited before debugger: ${JSON.stringify(exitResult)}\n${stderr}`);
      try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) }); if (response.ok) return await response.json(); } catch {}
      await delay(50);
    }
    throw new Error(`Debugger timeout: ${endpoint}\n${stderr}`);
  }
  const evaluate = async (fn, argument) => {
    const expression = `(${fn.toString()})(process.mainModule.require('electron'), ${JSON.stringify(argument) ?? 'undefined'})`;
    const response = await bridge.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  async function close() {
    if (closed) return exitResult;
    closed = true;
    let observation;
    if (bridge && !exitResult) {
      observation = await evaluate(() => globalThis.__startupSpeedEvents || []).catch(() => []);
      await evaluate(({ app }) => { setImmediate(() => app.quit()); return true; }).catch(() => {});
    }
    if (observation) events.push(...observation);
    bridge?.close();
    await bounded(browser?.close().catch(() => {}), 3000, null);
    let result = await bounded(exit, 20000, null);
    if (!result && child.pid && child.exitCode === null && child.signalCode === null) {
      events.push({ type: 'owned-launcher-fallback-cleanup', at: Date.now(), pid: child.pid });
      await bounded(new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve())), 6000, null);
      result = await bounded(exit, 5000, null);
    }
    if (!result) {
      events.push({ type: 'cleanup-timeout-handles-released', at: Date.now(), pid: child.pid });
      releaseOwnedHandles(child);
    }
    await save();
    if (!result || result.code !== 0) throw new Error(`Owned launcher did not exit cleanly: ${JSON.stringify(result)}; pid=${child.pid}`);
    return result;
  }
  try {
    const list = await debuggerJson(`http://127.0.0.1:${mainPort}/json/list`);
    bridge = await connectInspector(list[0].webSocketDebuggerUrl, inspectorEvents);
    await bridge.request('Runtime.enable', {});
    const moduleDeadline = Date.now() + 15000;
    while (true) {
      const ready = await bridge.request('Runtime.evaluate', { expression: 'Boolean(process.mainModule && typeof process.mainModule.require === "function")', returnByValue: true });
      if (ready.result?.value === true) break;
      if (exitResult || Date.now() > moduleDeadline) throw new Error('Electron main module did not initialize before observation');
      await delay(25);
    }
    events.push({ type: 'main-module-ready', at: Date.now() });
    await evaluate(({ app, BrowserWindow }) => {
      const events = globalThis.__startupSpeedEvents = [];
      const observe = win => {
        const event = (type, value = {}) => events.push({ type, at: Date.now(), id: win.id, ...value });
        event('observed', { url: win.webContents.getURL(), visible: win.isVisible() });
        win.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => event('did-fail-load', { code, description, url, mainFrame }));
        win.webContents.on('render-process-gone', (_event, detail) => event('render-process-gone', detail));
        win.webContents.on('did-finish-load', () => event('did-finish-load', { url: win.webContents.getURL() }));
        win.on('closed', () => event('closed'));
      };
      app.on('browser-window-created', (_event, win) => observe(win)); BrowserWindow.getAllWindows().forEach(observe);
      return true;
    });
    await debuggerJson(`http://127.0.0.1:${browserPort}/json/version`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { noDefaults: true, timeout: 15000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 30000 });
    return { evaluate, page, startedAt, attachedAt: Date.now(), pid: child.pid, close, saveLogs: save };
  } catch (error) {
    await close().catch(cleanup => { error.cleanupError = String(cleanup); });
    await save();
    throw error;
  }
}
