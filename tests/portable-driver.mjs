import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitJson(url, running, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (running.exitCode !== null) throw new Error(`Portable launcher exited before debugger was ready: ${running.exitCode}`);
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return await response.json(); } catch {}
    await delay(200);
  }
  throw new Error(`Portable debugger did not become ready: ${url}`);
}
async function inspector(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const task of pending.values()) task.reject(new Error('Inspector closed')); pending.clear(); });
  return { close: () => socket.close(), request: (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }) };
}

export async function launchPortable({ executablePath, args, env, timeout = 90000 }) {
  const mainPort = await freePort();
  const browserPort = await freePort();
  const child = spawn(executablePath, [...args, `--inspect=${mainPort}`, `--remote-debugging-port=${browserPort}`], { env, stdio: 'ignore', windowsHide: true });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  let bridge;
  let browser;
  try {
    const contexts = await waitJson(`http://127.0.0.1:${mainPort}/json/list`, child, timeout);
    bridge = await inspector(contexts[0].webSocketDebuggerUrl);
    await waitJson(`http://127.0.0.1:${browserPort}/json/version`, child, timeout);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { noDefaults: true });
    console.log(`Portable application attached directly; launcher PID=${child.pid}`);
    const evaluate = async (fn, argument) => {
      const expression = `(${fn.toString()})(process.mainModule.require('electron'), ${JSON.stringify(argument) ?? 'undefined'})`;
      const response = await bridge.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    return {
      evaluate,
      firstWindow: async () => {
        const context = browser.contexts()[0];
        return context.pages()[0] || await context.waitForEvent('page');
      },
      close: async () => {
        await evaluate(({ app }) => { setImmediate(() => app.quit()); return true; }).catch(() => {});
        bridge.close();
        await browser.close().catch(() => {});
        const result = await Promise.race([exited, delay(30000).then(() => { throw new Error('Portable launcher did not exit cleanly'); })]);
        if (result.code !== 0) throw new Error(`Portable exit code: ${JSON.stringify(result)}`);
      },
    };
  } catch (error) {
    bridge?.close();
    await browser?.close().catch(() => {});
    if (child.exitCode === null && child.pid) await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], () => resolve()));
    throw error;
  }
}
