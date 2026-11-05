export type PhotoshopMode = 'new-document' | 'insert-layers';
export type PhotoshopResult = { documentName: string; layerCount: number };
export type PhotoshopBridge = {
  sendPsd(blob: Blob, options: { name: string; mode: PhotoshopMode }): Promise<PhotoshopResult>;
};

const VERSION = 1;
const MAX_BYTES = 128 * 1024 * 1024;
let bridge: PhotoshopBridge | null = null;
function instanceToken(): string | null {
  if (typeof window === 'undefined' || window.parent === window || new URLSearchParams(window.location.search).get('photoshop') !== 'cep') return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('zizao-token');
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function photoshopRequestHeaders(): Record<string, string> {
  const token = instanceToken();
  return token ? { 'X-Zizao-Token': token } : {};
}

export function connectPhotoshop(): PhotoshopBridge | null {
  const token = instanceToken();
  if (!token) return null;
  if (bridge) return bridge;
  const channel = new MessageChannel();
  const pending = new Map<string, { resolve: (value: PhotoshopResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  let disconnected = false;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => rejectReady(new Error('Photoshop 面板连接超时，请重新打开字造面板。')), 20000);
  // CEP's file: parent has an opaque origin. Only this bootstrap uses '*';
  // the host validates child origin, WindowProxy and per-instance token.
  window.parent.postMessage({ type: 'zizao:connect', version: VERSION, token }, '*', [channel.port2]);
  channel.port1.onmessage = event => {
    const message = event.data;
    if (!message || message.version !== VERSION || message.token !== token) return;
    if (message.type === 'zizao:ready') {
      if (!Array.isArray(message.capabilities) || !message.capabilities.includes('layered-psd')) return;
      clearTimeout(readyTimer);
      resolveReady();
      return;
    }
    if (message.type !== 'zizao:result' || typeof message.requestId !== 'string') return;
    const task = pending.get(message.requestId);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(message.requestId);
    if (message.ok && typeof message.result?.documentName === 'string' && Number.isInteger(message.result?.layerCount)) task.resolve(message.result);
    else task.reject(new Error(typeof message.error === 'string' ? message.error : 'Photoshop 导入失败。'));
  };
  ready.catch(() => {});
  window.addEventListener('pagehide', () => {
    disconnected = true;
    clearTimeout(readyTimer);
    rejectReady(new Error('字造面板已关闭。'));
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('字造面板已关闭。')); }
    pending.clear();
    channel.port1.close();
    bridge = null;
  }, { once: true });
  bridge = {
    async sendPsd(blob, options) {
      if (disconnected) throw new Error('字造面板已关闭。');
      if (!['new-document', 'insert-layers'].includes(options.mode)) throw new Error('Photoshop 导入模式无效。');
      if (!blob.size || blob.size > MAX_BYTES) throw new Error('面板传输的 PSD 请控制在 128 MB 以内。');
      await ready;
      const bytes = await blob.arrayBuffer();
      const requestId = `psd-${Date.now()}-${++sequence}`;
      return new Promise<PhotoshopResult>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Photoshop 导入响应超时，请先检查 Photoshop 中的弹窗或导入结果。')); }, 120000);
        pending.set(requestId, { resolve, reject, timer });
        try { channel.port1.postMessage({ type: 'zizao:psd', version: VERSION, token, requestId, name: options.name, mode: options.mode, bytes }, [bytes]); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
    },
  };
  return bridge;
}
