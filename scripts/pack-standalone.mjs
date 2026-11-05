import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeZip } from './zip-writer.mjs';

/*
 * Builds the standalone (no-install) archive so that extraction can never spray
 * thousands of files into the folder the user picked: every entry lives under a
 * single top-level directory, and the readme travels inside that directory.
 *
 * Names are written with the UTF-8 general-purpose flag so Windows Explorer,
 * WinRAR and .NET read 字造.exe correctly regardless of the system code page.
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const root = path.resolve(arg('root', process.cwd()));
const input = path.resolve(arg('input', path.join(root, 'release/win-unpacked')));
const version = arg('version');
const output = path.resolve(arg('output', path.join(root, `release/${version}-final/字造-免安装.zip`)));
const readme = arg('readme', '');
const topFolder = arg('folder', `字造-${version}`);
const level = Number(arg('level', '6'));
if (!Number.isInteger(level) || level < 0 || level > 9) throw new Error('--level must be 0-9');

if (!version) throw new Error('--version is required');
if (!existsSync(input)) throw new Error(`input directory missing: ${input}`);
if (!statSync(input).isDirectory()) throw new Error(`input is not a directory: ${input}`);

const walk = (dir, base = '', out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(absolute, relative, out);
    else if (entry.isFile()) out.push({ relative, absolute, size: statSync(absolute).size });
  }
  return out;
};

const files = walk(input).sort((a, b) => a.relative.localeCompare(b.relative));
if (!files.length) throw new Error('input directory has no files');

mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.building`;
const started = Date.now();
const entries = files.map(file => ({ name: `${topFolder}/${file.relative}`, file: file.absolute }));
if (readme) {
  if (!existsSync(readme)) throw new Error(`readme missing: ${readme}`);
  entries.push({ name: `${topFolder}/${path.basename(readme)}`, file: readme });
}
// writeZip keeps CRC and both sizes in each local header; fflate's streaming
// writer used data descriptors, which Windows Explorer chokes on (0x80004005).
await writeZip(temporary, entries, { level });

if (existsSync(output)) rmSync(output, { force: true });
copyFileSync(temporary, output);
rmSync(temporary, { force: true });

const digest = createHash('sha256');
await new Promise((resolve, reject) => {
  const stream = createReadStream(output);
  stream.on('data', data => digest.update(data));
  stream.on('end', resolve);
  stream.on('error', reject);
});

console.log(JSON.stringify({
  ok: true,
  output,
  bytes: statSync(output).size,
  sha256: digest.digest('hex'),
  topFolder,
  level,
  files: files.length + (readme ? 1 : 0),
  uncompressedBytes: files.reduce((total, file) => total + file.size, 0) + (readme ? statSync(readme).size : 0),
  seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
}, null, 2));
