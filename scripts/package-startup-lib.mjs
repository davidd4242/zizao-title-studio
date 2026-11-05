import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
export function safeRelative(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value && !value.includes('\\') && !/[\x00-\x1f\x7f:]/.test(value), `Invalid package path: ${JSON.stringify(value)}`);
  assert.ok(!value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), `Invalid package path: ${value}`);
  return value;
}
const comparePaths = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
export async function inventory(folder) {
  const base = await realpath(folder);
  const files = [], names = new Set();
  async function visit(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = safeRelative(relative ? `${relative}/${entry.name}` : entry.name);
      const key = relativePath.normalize('NFC').toLowerCase();
      assert.ok(!names.has(key), `Duplicate Windows path: ${relativePath}`);
      names.add(key);
      const target = path.join(directory, entry.name), meta = await lstat(target);
      assert.ok(!meta.isSymbolicLink(), `Package link is not allowed: ${relativePath}`);
      if (meta.isDirectory()) await visit(target, relativePath);
      else {
        assert.ok(meta.isFile(), `Non-file package entry: ${relativePath}`);
        files.push({ path: relativePath, size: meta.size, sha256: await fileHash(target) });
      }
    }
  }
  await visit(base);
  return files.sort(comparePaths);
}
export function manifestSummary(files) {
  const groups = new Map();
  for (const file of files) {
    const key = `${file.size}:${file.sha256}`;
    const group = groups.get(key) || [];
    group.push(file.path); groups.set(key, group);
  }
  const duplicateContent = [...groups.entries()].filter(([, paths]) => paths.length > 1).map(([key, paths]) => ({ size: Number(key.split(':')[0]), sha256: key.split(':')[1], paths }));
  return { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), sha256: sha256(JSON.stringify(files)), duplicateContent };
}
export async function inspectRuntime(folder, executableName, version) {
  const files = await inventory(folder);
  const byPath = new Map(files.map(file => [file.path, file]));
  const packageFile = 'resources/app/package.json';
  for (const file of [executableName, packageFile, 'resources/app/desktop/main.cjs', 'resources/app/dist/index.html', 'resources/app/server/index.mjs', 'resources/app/server/font-worker.mjs', 'resources/app/server/outline.mjs', 'resources/app/assets/fonts/manifest.json']) assert.ok(byPath.has(file), `Runtime file missing: ${file}`);
  const pkg = JSON.parse(await readFile(path.join(folder, packageFile), 'utf8'));
  assert.equal(pkg.version, version, 'Runtime package version');
  assert.equal(pkg.main, 'desktop/main.cjs');
  const fontManifest = JSON.parse(await readFile(path.join(folder, 'resources/app/assets/fonts/manifest.json'), 'utf8'));
  assert.equal(fontManifest.fonts.length, 55);
  for (const font of fontManifest.fonts) {
    const found = byPath.get(`resources/app/assets/fonts/${safeRelative(font.file)}`);
    assert.ok(found, `Bundled font missing: ${font.file}`);
    assert.equal(found.size, font.size, font.file);
    assert.equal(found.sha256, font.sha256, font.file);
    assert.ok(byPath.get(`resources/app/assets/fonts/${safeRelative(font.licenseFile)}`)?.size > 100, `Font license missing: ${font.file}`);
  }
  return { files, summary: manifestSummary(files), package: pkg, executable: byPath.get(executableName), bundledFonts: fontManifest.fonts.length };
}
export async function sevenZip() {
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
  return getPath7za();
}
export async function listArchive(archive) {
  const tool = await sevenZip();
  const result = await execute(tool, ['l', '-slt', '-ba', '-sccUTF-8', archive], { windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const blocks = result.stdout.trim().split(/\r?\n\r?\n/), entries = [], names = new Set();
  for (const block of blocks) {
    const fields = Object.fromEntries(block.split(/\r?\n/).map(line => { const split = line.indexOf(' = '); return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 3)]; }));
    if (!fields.Path) continue;
    const relative = safeRelative(fields.Path.replaceAll('\\', '/').replace(/\/$/, ''));
    const key = relative.normalize('NFC').toLowerCase();
    assert.ok(!names.has(key), `Duplicate ZIP entry: ${relative}`); names.add(key);
    assert.ok(!fields['Symbolic Link'] && !fields['Hard Link'] && fields.Encrypted !== '+', `Unsupported ZIP entry: ${relative}`);
    const directory = fields.Folder === '+' || /^D/.test(fields.Attributes || '');
    if (!directory) {
      const size = Number(fields.Size); assert.ok(Number.isSafeInteger(size) && size >= 0, `Invalid ZIP size: ${relative}`);
      entries.push({ path: relative, size });
    }
  }
  assert.ok(entries.length > 0, 'ZIP contains no files');
  return { entries: entries.sort(comparePaths), listing: result.stdout };
}
export async function extractAndVerify(archive, expected, destination, evidenceDirectory) {
  const { entries, listing } = await listArchive(archive);
  assert.deepEqual(entries, expected.map(({ path: relative, size }) => ({ path: relative, size })), 'ZIP file set/size differs from runtime manifest');
  await mkdir(destination, { recursive: false });
  const tool = await sevenZip();
  const result = await execute(tool, ['x', '-y', '-bd', '-sccUTF-8', `-o${destination}`, archive], { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const actual = await inventory(destination);
  assert.deepEqual(actual, expected, 'Extracted ZIP bytes differ from runtime manifest');
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(path.join(evidenceDirectory, 'zip-listing.txt'), listing);
    await writeFile(path.join(evidenceDirectory, 'zip-extraction.log'), result.stdout + result.stderr);
    await writeFile(path.join(evidenceDirectory, 'extracted-manifest.json'), JSON.stringify(actual, null, 2));
  }
  return { path: destination, ...manifestSummary(actual), archiveSha256: await fileHash(archive) };
}
