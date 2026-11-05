import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const VERSION = '1.5.0';
const destination = path.resolve(root, `../字造-${VERSION}`);
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.version, VERSION, 'package.json version must be 1.5.0 before publishing');

const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
const records = [];
async function record(file, role) {
  const metadata = await stat(file);
  assert.ok(metadata.isFile(), `${file} must be a regular file`);
  const item = { file: path.relative(destination, file).split(path.sep).join('/'), bytes: metadata.size, sha256: await hash(file), role };
  records.push(item);
  return item;
}
// Copy without ever overwriting an existing final artifact: a mismatching file is a hard failure,
// because silently replacing it would hide a stale release.
async function copy(source, relative, role) {
  const before = await hash(source);
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

await mkdir(destination, { recursive: true });

// 1. installer + directory package.
// --pre-installer runs everything the NSIS build itself needs (manual, practice bundle, quick start),
// because desktop/installer.nsh embeds those files from this very directory. The full run afterwards
// adds the installer and the directory zip; every write here is idempotent and byte-checked.
const preInstaller = process.argv.includes('--pre-installer');
const installer = path.join(root, `release/字造-${VERSION}-完整安装版.exe`);
const archive = path.join(root, `release/1.5-final/wrapped/字造-免安装.zip`);
if (!preInstaller) {
  await copy(installer, `字造-${VERSION}-完整安装版.exe`, 'installer');
  await copy(archive, '字造-免安装.zip', 'recommended-application');
  await copy(path.join(root, 'release/字造.exe'), '可选单文件/字造.exe', 'optional-portable');
}

// 2. Photoshop panel package, as reported by its own build record
const photoshop = await json(path.join(root, 'verification/photoshop/release/latest.json'));
assert.equal(photoshop.version, VERSION, 'Photoshop package version must be 1.5.0');
assert.ok(photoshop.zip, 'Photoshop build record must contain a zip path');
await copy(photoshop.zip, '字造-Photoshop插件.zip', 'optional-photoshop-panel');
// 双击即装的版本。第一次打包前由 scripts/package-plugin-installer.mjs 用 NSIS 从
// 同一份解压载荷编译；这里只做字节核对，不再重新打包。
const panelInstaller = path.join(root, `release/字造-Photoshop插件-安装版-${VERSION}.exe`);
await copy(panelInstaller, `字造-Photoshop插件-安装版-${VERSION}.exe`, 'photoshop-panel-installer');

// 3. illustrated manual — it is written straight into the delivery directory by build-manual.mjs
const manual = await json(path.join(root, 'output/manual-1.5/manual-report.json'));
assert.equal(manual.status, 'passed', 'manual must be reviewed before publishing');
assert.equal(path.resolve(manual.file), path.join(destination, '字造-零基础图文说明书-长图.png'));
assert.equal(await hash(manual.file), manual.sha256, 'manual bytes changed after its report was written');
assert.ok(Number.isInteger(manual.width) && Number.isInteger(manual.height));
assert.ok(Array.isArray(manual.sections) && manual.sections.length === 27, '1.4 manual must have 27 chapters');
assert.equal(manual.images, 26, '1.4 manual must embed 26 real screenshots');
await record(manual.file, 'illustrated-manual');

// 4. practice material, zipped from the same folder the manual build used
const practiceNames = ['春日放送-练习.zizao.json', '春日放送-透明标题.png', '练习参考底图.png'];
const entries = {};
for (const name of practiceNames) {
  const source = path.join(root, 'output/manual-1.5/practice', name);
  entries[name] = new Uint8Array(await readFile(source));
  await copy(source, `练习素材/${name}`, 'manual-practice');
}
const practiceZip = zipSync(entries, { level: 6, mtime: new Date(2026, 10, 5, 0, 0, 0) });
const extracted = unzipSync(practiceZip);
assert.deepEqual(Object.keys(extracted).sort(), practiceNames.slice().sort());
for (const name of practiceNames) assert.deepEqual(extracted[name], entries[name]);
await create('字造-练习素材.zip', practiceZip, 'manual-practice-bundle');

// 5. quick start. No speed numbers: this round did not rerun the four-round timing, so it must not quote 1.3 values.
const quickStart = `字造 ${VERSION}\r\n\r\n先打开“字造-零基础图文说明书-长图.png”。这是一张完整长图，可以放大和向下滚动。\r\n\r\n开始使用\r\n右键“字造-免安装.zip”，选择“全部解压缩”。解压后会得到一个“字造-${VERSION}”文件夹，进入后双击“字造.exe”。如果解压完看到的是上千个散落的文件、没有一个“字造-${VERSION}”文件夹，说明选的是“解压到当前文件夹”，请新建一个空文件夹重新解压。保留 resources、DLL 和其他运行文件；需要桌面入口时创建快捷方式。完整解压一次后，正常启动直接读取本地文件，省去单文件便携包每次重新解压的等待。如果提示压缩包损坏或被截断，多半是传输时没传完整，重新传一次再解压。\r\n也可以用“字造-${VERSION}-完整安装版.exe”安装。安装包未签名，Windows 可能显示 SmartScreen 提示；确认文件名与来源后再继续。\r\n更新前先在旧字造窗口保存工程并退出，再打开新版。\r\n\r\n这次更新\r\n1. 双击画布上的单字，这个字周围会出现变换框：拖四个角点单独放大缩小，拖上方圆点单独旋转。按住 Shift 可等比缩放或按 15° 吸附，松手只算一次撤销。\r\n2. 右侧「单字排版」面板新增「单字缩放 X」「单字缩放 Y」，可以输入数字精确调整。\r\n3. 导出 PSD 的「逐元素」分层与画布渐变手柄保持上一版的做法。\r\n\r\n练习文件\r\n“练习素材”文件夹和“字造-练习素材.zip”内容相同。在字造中点击“打开工程”，选择“春日放送-练习.zizao.json”。透明PNG是已经导出的效果图，参考底图只供排版练习。\r\n\r\n离线使用\r\n字体、算法、素材、预览和导出均在本机运行。完整包已附带运行环境与55个字体家族。参考网站链接可选，编辑和导出不依赖这些网站。\r\n\r\nPhotoshop\r\n普通使用可直接导出PSD并在Photoshop中打开。需要嵌入面板时，双击“字造-Photoshop插件-安装版-${VERSION}.exe”，按向导点下一步就装好，装完重启 Photoshop，在「窗口 → 扩展（旧版）」里打开“字造”。安装程序只做两件事：把面板放进 CEP 扩展目录、把 PlayerDebugMode 设为 1；卸载时这两项按原样还原，卸载入口是安装目录里的“卸载字造面板.exe”。想手动安装或想先看文件清单，再用“字造-Photoshop插件.zip”：完整解压后读包内说明，保存并退出 Photoshop 后运行 Install.cmd。这个包有 8200 多个文件，解压要一两分钟，中途不要取消；如果 Install.cmd 提示 Package is incomplete，说明解压不完整或杀毒软件删了文件，删掉目录重新完整解压。\r\n\r\n保留工程\r\n使用“保存工程”保存 .zizao.json，供以后继续编辑；导出的PNG是图片。\r\n`;
await create('先看这里.txt', Buffer.from('\ufeff' + quickStart, 'utf8'), 'quick-start');

if (preInstaller) {
  console.log(JSON.stringify({ status: 'staged-for-installer', directory: destination, staged: records.map(item => item.file) }, null, 2));
} else {
  const manifest = {
    version: VERSION,
    createdAt: new Date().toISOString(),
    manual: { width: manual.width, height: manual.height, chapters: manual.sections.length, screenshots: manual.images, sha256: manual.sha256 },
    photoshop: { version: photoshop.version, sha256: photoshop.sha256 },
    artifacts: records,
  };
  await create('SHA256SUMS.txt', Buffer.from(records.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n', 'utf8'), 'checksums');
  await writeFile(path.join(root, `verification/release-${VERSION}.json`), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ status: 'verified', directory: destination, ...manifest }, null, 2));
}
