const { app, BrowserWindow, dialog, Menu, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('字造');
app.setAppUserModelId('studio.zizao.desktop');
protocol.registerSchemesAsPrivileged([{ scheme: 'zizao', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const profile = app.commandLine.getSwitchValue('user-data-dir');
if (profile && path.isAbsolute(profile)) app.setPath('userData', profile);
else app.setPath('userData', path.join(app.getPath('appData'), 'ZizaoStudio'));
const hidden = app.commandLine.hasSwitch('smoke-test');
let window;
let server;
let closing = false;
const allowedAppUrl = value => {
  try { const url = new URL(value); return url.protocol === 'zizao:' && url.hostname === 'studio' && !url.port && !url.username && !url.password; }
  catch { return false; }
};
function external(value) {
  try { if (new URL(value).protocol === 'https:') void shell.openExternal(value); } catch {}
}
async function closeServer() {
  if (!server) return;
  const running = server;
  server = undefined;
  await Promise.all([running.fontService.close(), new Promise(resolve => { running.close(resolve); running.closeAllConnections(); })]);
}
async function fail(error) {
  if (closing) return;
  const text = error?.stack || String(error);
  const log = path.join(app.getPath('userData'), 'startup-error.log');
  await fs.mkdir(path.dirname(log), { recursive: true }).then(() => fs.appendFile(log, `${new Date().toISOString()}\n${text}\n`)).catch(() => {});
  await closeServer().catch(() => {});
  console.error(text);
  if (window && !window.isDestroyed()) {
    try {
      const loadingFile = path.join(app.getAppPath(), 'desktop', 'loading.html');
      if (window.webContents.getURL() !== pathToFileURL(loadingFile).href) await window.loadFile(loadingFile);
      const detail = `${error?.message || error}\n\n启动详情：${log}\n请关闭窗口后重试。`;
      await window.webContents.executeJavaScript(`document.body.classList.add('failed'); document.getElementById('startup-title').textContent = '启动遇到问题'; document.getElementById('startup-status').setAttribute('role', 'alert'); document.getElementById('startup-detail').textContent = ${JSON.stringify(detail)};`);
      if (!hidden) { window.show(); return; }
    } catch {}
  }
  if (!hidden) dialog.showErrorBox('字造启动失败', `启动详情已写入：${log}\n\n${error?.message || error}`);
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (closing) return;
    closing = true;
    if (!server) return;
    event.preventDefault();
    closeServer().finally(() => app.quit());
  });
  app.whenReady().then(async () => {
    const root = app.getAppPath();
    const desktopSession = session.defaultSession;
    desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    desktopSession.setPermissionCheckHandler(() => false);
    desktopSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    desktopSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: '保存字造作品', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), properties: ['showOverwriteConfirmation', 'createDirectory'] });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [{ role: 'quit', label: '退出字造' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '视图', submenu: [{ role: 'reload', label: '重新载入' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大界面' }, { role: 'zoomOut', label: '缩小界面' }, { role: 'togglefullscreen', label: '全屏' }] },
    ]));
    const displays = screen.getAllDisplays();
    const display = displays.find(item => item.size.width === 1920 && item.size.height === 1080) || displays.find(item => !/LG|TV/i.test(item.label || '') && item.size.height <= 1200) || screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(1480, area.width - 32);
    const height = Math.min(980, area.height - 32);
    window = new BrowserWindow({
      title: '字造 · 封面标题工作室', width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2),
      minWidth: 800, minHeight: 600, show: !hidden, autoHideMenuBar: true, backgroundColor: '#f7f7f5', icon: path.join(root, 'desktop', 'icon.ico'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, webSecurity: true },
    });
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (!allowedAppUrl(url)) { event.preventDefault(); external(url); } });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('closed', () => { window = undefined; });
    // Paint a local shell before importing or starting the service, including on slow disks.
    await window.loadFile(path.join(root, 'desktop', 'loading.html'));
    if (closing || !window) return;
    console.log('ZIZAO_DESKTOP_LOADING');
    const { start } = await import(pathToFileURL(path.join(root, 'server', 'index.mjs')).href);
    if (closing || !window) return;
    server = await start({ port: 0, dataDir: path.join(app.getPath('userData'), 'fonts'), staticDir: path.join(root, 'dist') });
    if (closing || !window) { await closeServer(); return; }
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    await desktopSession.protocol.handle('zizao', async request => {
      if (!allowedAppUrl(request.url)) return new Response('Invalid application address', { status: 403 });
      const url = new URL(request.url);
      const headers = {};
      if (request.headers.has('content-type')) headers['content-type'] = request.headers.get('content-type');
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      return fetch(`${localOrigin}${url.pathname}${url.search}`, { method: request.method, headers, body });
    });
    await window.loadURL('zizao://studio/');
    console.log(`ZIZAO_DESKTOP_READY ${JSON.stringify({ version: app.getVersion(), packaged: app.isPackaged, origin: 'zizao://studio', dataDir: app.getPath('userData'), servicePort: server.address().port })}`);
  }).catch(fail);
}
