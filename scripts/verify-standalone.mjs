import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const zip = path.resolve(process.argv[2]);
const source = path.resolve(process.argv[3]);
const folder = process.argv[4] ?? '字造-1.5.0';
const extra = process.argv.slice(5);

const dest = path.join(os.tmpdir(), `zizao-unzip-${Date.now()}`);
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`], { stdio: 'inherit' });

const walk = (dir, base = '', out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(absolute, relative, out);
    else out.push(relative);
  }
  return out;
};
const digest = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  stream.on('data', data => hash.update(data));
  stream.on('end', () => resolve(hash.digest('hex')));
  stream.on('error', reject);
});

const top = readdirSync(dest);
if (top.length !== 1 || top[0] !== folder) throw new Error(`top level must be exactly ${folder}, got ${JSON.stringify(top)}`);

const root = path.join(dest, folder);
const extracted = walk(root).sort();
const expected = walk(source).sort();
const missing = expected.filter(name => !extracted.includes(name));
const isExtra = name => extra.some(e => { const base = path.basename(e); return name === base || name.endsWith('/' + base); });
const unexpected = extracted.filter(name => !expected.includes(name) && !isExtra(name));
let mismatch = 0;
const firstMismatch = [];
for (const name of expected) {
  if (!extracted.includes(name)) continue;
  const a = await digest(path.join(root, name));
  const b = await digest(path.join(source, name));
  if (a !== b) { mismatch += 1; if (firstMismatch.length < 5) firstMismatch.push(name); }
}
const report = {
  zip, folder, extractedFiles: extracted.length, sourceFiles: expected.length,
  missing, unexpected, contentMismatch: mismatch, firstMismatch,
  extraFiles: extra.map(e => ({ file: path.basename(e), present: extracted.some(n => n === path.basename(e) || n.endsWith("/" + path.basename(e))) })),
};
console.log(JSON.stringify(report, null, 2));
if (missing.length || unexpected.length || mismatch) process.exitCode = 1;
