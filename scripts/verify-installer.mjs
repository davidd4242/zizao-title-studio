// 单一安装包验收：解出安装内容，逐字节比对主程序与随包资料。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'F:/dnowload/封面/title-studio';
const INSTALLER = path.join(ROOT, 'release/字造-1.5.0-完整安装版.exe');
const APP_SRC = path.join(ROOT, 'release/win-unpacked');
const EXTRA_SRC = 'F:/dnowload/封面/字造-1.5.0';
const SEVEN_ZIP = 'C:/Users/DAVID/AppData/Local/electron-builder/Cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe';
const OUT = path.join(ROOT, 'verification/installer-1.5.0');

const hash = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (chunk) => h.update(chunk)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

const walk = (dir, base = '') => {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full, rel));
    else if (entry.isFile()) rows.push({ rel, bytes: fs.statSync(full).size, full });
  }
  return rows;
};

const extract = (archive, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  try {
    execFileSync(SEVEN_ZIP, ['x', archive, `-o${dest}`, '-y'], { stdio: 'pipe' });
  } catch (error) {
    // NSIS 里带签名/解压器小节会让 7za 报少量错误；只要目标文件解出即继续，由逐文件比对定论。
    if (!fs.existsSync(dest)) throw error;
  }
};

const report = { installer: path.basename(INSTALLER), generatedAt: new Date().toISOString(), problems: [] };

report.installerBytes = fs.statSync(INSTALLER).size;
report.installerSha256 = await hash(INSTALLER);

const unsealed = path.join(OUT, 'unsealed');
const appOut = path.join(OUT, 'app');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(unsealed, { recursive: true });
extract(INSTALLER, unsealed);

const nested = fs.readdirSync(unsealed).filter((name) => /^app-\d+\.7z$/.test(name));
if (nested.length === 1) extract(path.join(unsealed, nested[0]), appOut);
const appRoot = nested.length === 1 ? appOut : unsealed;

const appActual = new Map(walk(appRoot).filter((row) => !row.rel.startsWith('使用说明/')).map((row) => [row.rel, row]));
const appExpected = walk(APP_SRC).filter((row) => row.rel !== '字造-1.5.0-完整安装版.exe');
let appChecked = 0;
for (const expected of appExpected) {
  const actual = appActual.get(expected.rel);
  if (!actual) { report.problems.push(`missing in installer: ${expected.rel}`); continue; }
  if (actual.bytes !== expected.bytes) { report.problems.push(`size mismatch: ${expected.rel}`); continue; }
  if ((await hash(actual.full)) !== (await hash(expected.full))) { report.problems.push(`hash mismatch: ${expected.rel}`); continue; }
  appChecked += 1;
}
report.app = { expectedFiles: appExpected.length, checked: appChecked, extra: [...appActual.keys()].filter((key) => !appExpected.some((row) => row.rel === key)) };

// 随包资料由安装脚本在安装阶段写入，7z 只能展开主程序载荷；
// 它们在 scripts/verify-installed.mjs 中按安装结果逐个比对。

report.ok = report.problems.length === 0;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

console.log(`INSTALLER ${report.installerBytes} bytes sha256=${report.installerSha256}`);
console.log(`APP files ${appChecked}/${report.app.expectedFiles} byte-identical`);
console.log(report.ok ? 'INSTALLER VERIFIED' : `INSTALLER PROBLEMS: ${report.problems.join(' | ')}`);
process.exit(report.ok ? 0 : 1);
