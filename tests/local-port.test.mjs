import assert from 'node:assert/strict';
import { test } from 'node:test';
import { start, listenLocal } from '../server/index.mjs';

async function close(server) {
  await server.fontService?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
const options = { includeSystemFonts: false, includeBundledFonts: false, scanRegistry: false, fontDirectories: [] };

test('automatic editor ports are browser-compatible and serve actual HTTP after repeated starts', async () => {
  const active = [];
  try {
    for (let i = 0; i < 8; i++) {
      const server = await start({ ...options, port: 0 });
      active.push(server);
      const port = server.address().port;
      assert.ok(port >= 49152 && port <= 65535, `Automatic service port ${port} must stay in the browser-compatible dynamic range`);
      const response = await fetch(`http://127.0.0.1:${port}/api/not-found`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, '接口不存在');
    }
    assert.equal(new Set(active.map(server => server.address().port)).size, active.length);
  } finally { await Promise.all(active.map(close)); }
});

test('explicit occupied port reports the real bind error without moving or disturbing its owner', async () => {
  const owner = await start({ ...options, port: 0 });
  try {
    const port = owner.address().port;
    await assert.rejects(start({ ...options, port }), { code: 'EADDRINUSE' });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/not-found`)).status, 404);
  } finally { await close(owner); }
});

test('synchronous listen failure leaves the existing server and listeners intact', async () => {
  const server = await start({ ...options, port: 0 });
  try {
    const events = ['error', 'listening'];
    const counts = events.map(event => server.listenerCount(event));
    const port = server.address().port;
    await assert.rejects(listenLocal(server, 0), { code: 'ERR_SERVER_ALREADY_LISTEN' });
    assert.deepEqual(events.map(event => server.listenerCount(event)), counts);
    assert.equal(server.address().port, port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/not-found`)).status, 404);
  } finally { await close(server); }
});

test('an explicitly chosen free high port is preserved exactly', async () => {
  const probe = await start({ ...options, port: 0 });
  const port = probe.address().port;
  await close(probe);
  let server;
  try {
    server = await start({ ...options, port });
    assert.equal(server.address().port, port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/not-found`)).status, 404);
  } finally { if (server) await close(server); }
});
