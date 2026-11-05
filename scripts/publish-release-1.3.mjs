import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(root, '../字造-1.3.0');
const linkPath = process.argv[2];
assert.ok(linkPath, 'Pass the successful final linked evidence report');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const linked = await json(path.resolve(linkPath));
assert.equal(linked.ok, true); assert.equal(linked.version, '1.3.0');
const packaged = await json(linked.paths.package);
const offline = await json(linked.paths.offline);
const speed = await json(linked.paths.speed);
const photoshop = await json(offline.package.record);
const psReceipt = await json(path.join(path.dirname(offline.package.record), 'verification/passed-receipt.json'));
assert.equal(psReceipt.status, 'passed'); assert.equal(psReceipt.valid, true);
assert.equal(psReceipt.zip.sha256, photoshop.sha256);
assert.equal(createHash('sha256').update(await readFile(offline.package.record)).digest('hex'), psReceipt.releaseRecord.sha256);
const manual = await json(path.join(root, 'output/manual-1.3/manual-report.json'));
assert.equal(packaged.ok, true); assert.equal(offline.ok, true); assert.equal(speed.ok, true);
assert.equal(manual.status, 'passed');
assert.equal(manual.sections.length, 24); assert.equal(manual.images, 22);
assert.equal(speed.runs.length, 4);
assert.equal(photoshop.version, '1.3.0');
await mkdir(destination, { recursive: true });

async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
const records = [];
async function record(file, role) {
  const metadata = await stat(file);
  assert.ok(metadata.isFile());
  const item = { file: path.relative(destination, file).split(path.sep).join('/'), bytes: metadata.size, sha256: await hash(file), role };
  records.push(item); return item;
}
async function copy(source, relative, expected, role) {
  const before = await hash(source);
  if (expected) assert.equal(before, expected, `Source changed: ${relative}`);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  try { await copyFile(source, target, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.equal(await hash(target), before, `Existing destination differs: ${relative}`);
  return record(target, role);
}
async function create(relative, bytes, role) {
  const target = path.join(destination, relative);
  try { await writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.deepEqual(await readFile(target), Buffer.from(bytes), `Existing generated file differs: ${relative}`);
  return record(target, role);
}

const archive = packaged.publishedArchive || packaged.archive;
await copy(archive.path, '字造-免安装.zip', archive.sha256, 'recommended-application');
await copy(photoshop.zip, '字造-Photoshop插件.zip', photoshop.sha256, 'optional-photoshop-panel');
assert.equal(path.resolve(manual.file), path.join(destination, '字造-零基础图文说明书-长图.png'));
assert.equal(await hash(manual.file), manual.sha256);
await record(manual.file, 'illustrated-manual');
await copy(offline.exe.path, '可选单文件/字造.exe', offline.exe.sha256, 'optional-portable-application');

const names = ['春日放送-练习.zizao.json', '春日放送-透明标题.png', '练习参考底图.png'];
const entries = {};
for (const name of names) {
  const source = path.join(root, 'output/manual-1.3/practice', name);
  entries[name] = new Uint8Array(await readFile(source));
  await copy(source, `练习素材/${name}`, null, 'manual-practice');
}
const practiceZip = zipSync(entries, { level: 6, mtime: new Date(2026, 10, 5, 0, 0, 0) });
const extracted = unzipSync(practiceZip);
assert.deepEqual(Object.keys(extracted).sort(), names.slice().sort());
for (const name of names) assert.deepEqual(extracted[name], entries[name]);
await create('字造-练习素材.zip', practiceZip, 'manual-practice-bundle');
const seconds = n => (n / 1000).toFixed(3);
const [first, again] = speed.comparison;
const text = `字造 1.3.0\r\n\r\n先打开“字造-零基础图文说明书-长图.png”。这是一张完整长图，可以放大和向下滚动。\r\n\r\n开始使用\r\n右键“字造-免安装.zip”，选择“全部解压缩”。进入解压后的文件夹，双击“字造.exe”。保留 resources、DLL 和其他运行文件；需要桌面入口时创建快捷方式。\r\n更新前先在旧字造窗口保存工程并退出，再打开新版。\r\n\r\n练习文件\r\n“练习素材”文件夹和“字造-练习素材.zip”内容相同。在字造中点击“打开工程”，选择“春日放送-练习.zizao.json”。透明PNG是已经导出的效果图，参考底图只供排版练习。\r\n\r\n启动速度\r\n本机同字节隔离测试：目录包新配置 ${seconds(first.directoryReadyMs)} 秒、再次 ${seconds(again.directoryReadyMs)} 秒；单文件程序分别 ${seconds(first.portableReadyMs)}、${seconds(again.portableReadyMs)} 秒。计时从启动到编辑器可用，包含调试连接；新配置并非系统冷缓存。目录包省去了每次重新解压的等待。\r\n“可选单文件”中的程序仍会每次解压，适合只想携带一个EXE的情况，日常优先使用目录包。\r\n\r\n离线使用\r\n字体、算法、素材、预览和导出均在本机运行。完整包已附带运行环境与55个字体家族。参考网站链接可选，编辑和导出不依赖这些网站。\r\n\r\nPhotoshop\r\n普通使用可直接导出PSD并在Photoshop中打开。需要嵌入面板时，完整解压“字造-Photoshop插件.zip”，阅读包内说明，保存并退出Photoshop后安装。当前版本的实包编辑器、运行时、消息交接及端口回退已验证；未在本机当前Photoshop会话中重启挂载新版CEP。\r\n\r\n保留工程\r\n使用“保存工程”保存 .zizao.json，供以后继续编辑；导出的PNG是图片。\r\n`;
await create('先看这里.txt', Buffer.from('\ufeff' + text, 'utf8'), 'quick-start');
const manifest = { version: '1.3.0', createdAt: new Date().toISOString(), linkedEvidence: path.resolve(linkPath), linkedEvidenceSha256: await hash(path.resolve(linkPath)), directoryManifestSha256: packaged.inputSummary.sha256, manual: { width: manual.width, height: manual.height, chapters: manual.sections.length, screenshots: manual.images }, artifacts: records };
await create('SHA256SUMS.txt', Buffer.from(records.map(item => `${item.sha256}  ${item.file}`).join('\r\n') + '\r\n', 'utf8'), 'checksums');
await writeFile(path.join(root, 'verification/release-1.3.0.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ status: 'verified', directory: destination, ...manifest }, null, 2));
