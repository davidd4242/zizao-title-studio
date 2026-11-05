// One-shot 1.4.0 → 1.5.0 version migration for build and verification scripts.
// Idempotent: running it twice leaves the files unchanged.
import fs from 'node:fs';

const edits = [
  ['package.json', [['"version": "1.4.0"', '"version": "1.5.0"']]],
  ['package-lock.json', [['"version": "1.4.0"', '"version": "1.5.0"']]],
  ['desktop/builder-installer.cjs', [['字造-1.4.0-完整安装版.exe', '字造-1.5.0-完整安装版.exe']]],
  ['desktop/installer.nsh', [['字造-1.4.0', '字造-1.5.0']]],
  ['scripts/verify-installer.mjs', [['字造-1.4.0', '字造-1.5.0'], ['installer-1.4.0', 'installer-1.5.0']]],
  ['scripts/verify-installed.mjs', [['字造-1.4.0', '字造-1.5.0'], ['installer-1.4.0', 'installer-1.5.0']]],
  ['scripts/install-smoke.ps1', [['字造-1.4.0', '字造-1.5.0'], ['installer-1.4.0', 'installer-1.5.0']]],
  ['scripts/uninstall-smoke.ps1', [['字造-1.4.0', '字造-1.5.0'], ['installer-1.4.0', 'installer-1.5.0']]],
];

for (const [file, pairs] of edits) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of pairs) after = after.split(from).join(to);
  if (after === before) { console.log(`unchanged ${file}`); continue; }
  fs.writeFileSync(file, after);
  console.log(`updated   ${file}`);
}
