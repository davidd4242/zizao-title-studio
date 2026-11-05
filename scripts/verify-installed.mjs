// 安装结果验收：已安装文件逐字节等同冻结目录；随包资料等同发布原件。
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'F:/dnowload/封面/title-studio';
const INSTALLED = path.join(ROOT, 'verification/installer-1.5.0/installed');
const APP_SRC = path.join(ROOT, 'release/win-unpacked');
const EXTRA_SRC = 'F:/dnowload/封面/字造-1.5.0';

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

const report = { generatedAt: new Date().toISOString(), problems: [] };
const installed = new Map(walk(INSTALLED).map((row) => [row.rel, row]));
const expected = walk(APP_SRC).filter((row) => !row.rel.startsWith('使用说明/') && !/^Uninstall .*\.exe$/.test(row.rel));

let checked = 0;
for (const file of expected) {
  const actual = installed.get(file.rel);
  if (!actual) { report.problems.push(`missing: ${file.rel}`); continue; }
  if (actual.bytes !== file.bytes) { report.problems.push(`size: ${file.rel}`); continue; }
  if ((await hash(actual.full)) !== (await hash(file.full))) { report.problems.push(`hash: ${file.rel}`); continue; }
  checked += 1;
}
report.app = { expected: expected.length, checked };

report.extras = [];
for (const name of ['字造-零基础图文说明书-长图.png', '字造-练习素材.zip', '字造-Photoshop插件.zip', '先看这里.txt']) {
  const actual = path.join(INSTALLED, '使用说明', name);
  const source = path.join(EXTRA_SRC, name);
  if (!fs.existsSync(actual)) { report.problems.push(`missing extra: ${name}`); continue; }
  const same = fs.statSync(actual).size === fs.statSync(source).size && (await hash(actual)) === (await hash(source));
  if (!same) report.problems.push(`extra hash: ${name}`);
  report.extras.push({ name, bytes: fs.statSync(actual).size, matchesRelease: same });
}

const uninstallers = fs.readdirSync(INSTALLED).filter((name) => /^Uninstall .*\.exe$/.test(name));
report.uninstaller = uninstallers;
if (uninstallers.length !== 1) report.problems.push(`uninstaller count ${uninstallers.length}`);

report.ok = report.problems.length === 0;
fs.writeFileSync(path.join(ROOT, 'verification/installer-1.5.0/installed-report.json'), JSON.stringify(report, null, 2));
console.log(`APP ${checked}/${expected.length} byte-identical; uninstaller=${uninstallers.join(',') || 'none'}`);
for (const extra of report.extras) console.log(`EXTRA ${extra.name} ${extra.bytes} match=${extra.matchesRelease}`);
console.log(report.ok ? 'INSTALLED VERIFIED' : `INSTALLED PROBLEMS: ${report.problems.join(' | ')}`);
process.exit(report.ok ? 0 : 1);
