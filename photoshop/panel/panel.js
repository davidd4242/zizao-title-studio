(function () {
  'use strict';
  var iframe = document.getElementById('editor');
  var status = document.getElementById('status');
  var detail = document.getElementById('detail');
  var messageBox = document.getElementById('message');
  var retry = document.getElementById('retry');
  var runtime, port, origin, busy = false, connected = false;
  function fail(error) {
    status.textContent = '连接中断';
    detail.textContent = String(error && error.message || error);
    messageBox.hidden = false;
    retry.hidden = false;
  }
  function send(value) {
    if (port) port.postMessage(Object.assign({ version: 1, token: runtime.token }, value));
  }
  async function receive(event) {
    var message = event.data;
    if (!message || message.version !== 1 || message.token !== runtime.token || message.type !== 'zizao:psd') return;
    if (busy) { send({ type: 'zizao:result', requestId: message.requestId, ok: false, error: '已有 PSD 正在导入，请等待 Photoshop 返回。' }); return; }
    busy = true;
    status.textContent = '正在导入分层 PSD…';
    var item;
    try {
      item = runtime.writePsd(message);
      var result = await new Promise(function (resolve, reject) {
        window.__adobe_cep__.evalScript(item.script, function (value) {
          try {
            var parsed = JSON.parse(value);
            if (!parsed.ok) reject(new Error(parsed.error || 'Photoshop 导入失败。'));
            else resolve(parsed.result);
          } catch (error) { reject(new Error(value === 'EvalScript error.' ? 'Photoshop 脚本执行失败，请检查当前弹窗。' : error.message)); }
        });
      });
      send({ type: 'zizao:result', requestId: item.requestId, ok: true, result: result });
      status.textContent = '已送入 ' + result.documentName;
    } catch (error) {
      send({ type: 'zizao:result', requestId: message.requestId, ok: false, error: error.message });
      status.textContent = error.message;
    } finally {
      if (item) runtime.release(item.file);
      busy = false;
    }
  }
  window.addEventListener('message', function (event) {
    if (!runtime || event.source !== iframe.contentWindow || event.origin !== origin) return;
    var message = event.data;
    if (!message || message.type !== 'zizao:connect' || message.version !== 1 || message.token !== runtime.token || event.ports.length !== 1) return;
    if (port) port.close();
    port = event.ports[0];
    port.onmessage = receive;
    port.start();
    connected = true;
    send({ type: 'zizao:ready', capabilities: ['layered-psd', 'new-document', 'insert-layers'], maxBytes: 134217728 });
    status.textContent = '离线就绪 · PSD 文字为像素图层';
  });
  async function boot() {
    if (runtime) runtime.close();
    if (port) port.close();
    connected = false;
    iframe.classList.remove('ready');
    retry.hidden = true;
    messageBox.hidden = false;
    detail.textContent = '正在启动内置字体服务。';
    try {
      if (!window.__adobe_cep__ || !window.cep_node) throw new Error('请在 Photoshop 的“窗口 → 扩展（旧版）”中打开字造。');
      var extensionRoot = window.__adobe_cep__.getSystemPath('extension');
      extensionRoot = decodeURI(extensionRoot.replace(/^file:\/\//, '')).replace(/^\/([a-zA-Z]:)/, '$1');
      var host = window.cep_node.require(extensionRoot + '/panel/host.cjs');
      runtime = host.launch(extensionRoot);
      var connection = await runtime.ready;
      origin = connection.origin;
      iframe.src = origin + '/?photoshop=cep#zizao-token=' + connection.token;
      iframe.onload = function () {
        iframe.classList.add('ready');
        messageBox.hidden = true;
        if (!connected) status.textContent = '编辑器已加载 · 等待桥连接';
      };
      runtime.child.once('exit', function () { if (document.body.isConnected) fail(new Error('字体服务已结束。重新打开面板可恢复。')); });
    } catch (error) { fail(error); }
  }
  function close() { if (port) port.close(); if (runtime) runtime.close(); }
  window.addEventListener('beforeunload', close);
  window.addEventListener('unload', close);
  retry.addEventListener('click', boot);
  boot();
}());
