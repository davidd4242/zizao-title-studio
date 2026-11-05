'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');
const MAX_BYTES = 128 * 1024 * 1024;

function safeName(value) {
  const name = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100).trim() : '';
  return !name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? '字造标题' : name;
}
function validateMessage(message, token) {
  if (!message || message.type !== 'zizao:psd' || message.version !== 1 || message.token !== token) throw new Error('面板请求校验失败。');
  if (typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(message.requestId)) throw new Error('请求编号无效。');
  if (!['new-document', 'insert-layers'].includes(message.mode)) throw new Error('导入模式无效。');
  let bytes;
  if (Object.prototype.toString.call(message.bytes) === '[object ArrayBuffer]') bytes = Buffer.from(new Uint8Array(message.bytes));
  else if (typeof message.base64 === 'string' && message.base64.length <= Math.ceil(MAX_BYTES / 3) * 4 && message.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(message.base64)) bytes = Buffer.from(message.base64, 'base64');
  else throw new Error('PSD 数据格式无效。');
  if (bytes.length < 26 || bytes.length > MAX_BYTES || bytes.toString('ascii', 0, 4) !== '8BPS' || bytes.readUInt16BE(4) !== 1) throw new Error('请传入有效且小于 128 MB 的 PSD。');
  const height = bytes.readUInt32BE(14), width = bytes.readUInt32BE(18);
  if (!width || !height || width > 30000 || height > 30000 || bytes.readUInt16BE(22) !== 8 || bytes.readUInt16BE(24) !== 3) throw new Error('PSD 应为 8 位 RGB，宽高上限 30000 像素。');
  return { bytes, name: safeName(message.name), mode: message.mode, requestId: message.requestId };
}
function jsxCall(file, name, mode) {
  const quote = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `Zizao.importPsd(${quote(file)},${quote(name)},${quote(mode)})`;
}
function launch(extensionRoot, options = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zizao-photoshop-'));
  const dataDir = options.dataDir || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ZizaoPhotoshop');
  const executable = options.executable || path.join(extensionRoot, 'runtime', 'node.exe');
  const entry = path.join(extensionRoot, 'runtime', 'server.mjs');
  let closed = false;
  let timer;
  const env = Object.assign({}, process.env, { ZIZAO_TOKEN: token, ZIZAO_PARENT_PID: String(process.pid), ZIZAO_DATA_DIR: dataDir });
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = childProcess.spawn(executable, [entry], { cwd: extensionRoot, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(() => { close(); reject(new Error('离线编辑器启动超时。')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); if (!closed) reject(new Error(`离线编辑器已退出 (${code || signal || 0}) ${stderr}`)); });
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 65536) { close(); reject(new Error('服务启动输出异常。')); return; }
      let at;
      while ((at = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, at); stdout = stdout.slice(at + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'zizao:server-ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.origin)) {
            clearTimeout(timer); resolve({ origin: message.origin, token, pid: child.pid });
          }
        } catch (_) {}
      }
    });
  });
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    child.stdin.end();
    const kill = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 2500);
    kill.unref();
    child.once('exit', () => clearTimeout(kill));
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
  function writePsd(message) {
    if (closed) throw new Error('编辑器服务已关闭。');
    const request = validateMessage(message, token);
    const file = path.join(tempDir, `${crypto.randomBytes(12).toString('hex')}.psd`);
    fs.writeFileSync(file, request.bytes, { flag: 'wx' });
    return { file, script: jsxCall(file, request.name, request.mode), requestId: request.requestId };
  }
  function release(file) {
    if (path.dirname(file) !== tempDir || path.extname(file) !== '.psd') throw new Error('临时文件路径校验失败。');
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ready, close, writePsd, release, child, token, tempDir };
}
module.exports = { launch, safeName, validateMessage, jsxCall, MAX_BYTES };
