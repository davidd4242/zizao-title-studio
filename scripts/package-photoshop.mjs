import { mkdir, cp, copyFile, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from './zip-writer.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { build } from 'vite';
import react from '@vitejs/plugin-react';


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'com.zizao.title-studio';
export const defaultOutput = path.join(root, 'verification/photoshop/release');
export function renderManifest(template, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid CEP package version: ${version}`);
  if (template.split('{{VERSION}}').length !== 3) throw new Error('CEP template must declare both bundle and panel versions.');
  return template.replaceAll('{{VERSION}}', version);
}
export const snapshotDigest = files => createHash('sha256').update(JSON.stringify(files)).digest('hex');
export async function collectDependencies(manifestPath) {
  const found = new Map();
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  async function visit(name, from) {
    const require = createRequire(from);
    let entry;
    try { entry = require.resolve(`${name}/package.json`); }
    catch {
      let folder = path.dirname(require.resolve(name));
      while (folder !== path.dirname(folder)) {
        try { const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')); if (pkg.name === name) { entry = path.join(folder, 'package.json'); break; } } catch {}
        folder = path.dirname(folder);
      }
    }
    if (!entry) throw new Error(`Package not found: ${name}`);
    const pkg = JSON.parse(await readFile(entry, 'utf8'));
    if (found.has(entry)) return;
    const directory = path.dirname(entry);
    const relative = path.relative(path.join(path.dirname(manifestPath), 'node_modules'), directory).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Dependency is outside this installation: ${entry}`);
    found.set(entry, { name, version: pkg.version, directory, relative, license: pkg.license });
    for (const child of Object.keys(pkg.dependencies || {})) await visit(child, entry);
    for (const child of Object.keys(pkg.optionalDependencies || {})) {
      try { await visit(child, entry); } catch (error) { if (!/not found|Cannot find module/.test(error.message)) throw error; }
    }
  }
  for (const name of Object.keys(manifest.dependencies || {})) await visit(name, manifestPath);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export async function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute, base));
    else if (entry.isFile()) files.push(path.relative(base, absolute).split(path.sep).join('/'));
    else throw new Error(`Nonregular package entry: ${absolute}`);
  }
  return files.sort();
}
export async function hashFiles(directory) {
  const records = [];
  for (const file of await listFiles(directory)) {
    const bytes = await readFile(path.join(directory, file));
    records.push({ file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return records;
}
async function archive(directory, output) {
  // fflate's streaming writer marks every entry with a data descriptor (flag bit 3),
  // which makes Windows Explorer fail with 0x80004005 on some files. Sizes are known
  // here, so write them into the local headers instead.
  const prefix = path.basename(directory);
  const entries = (await listFiles(directory)).map(file => ({ name: `${prefix}/${file}`, file: path.join(directory, file) }));
  await writeZip(output, entries, { level: 9 });
}
async function sourceSnapshot() {
  const result = [];
  for (const directory of ['src', 'server', 'photoshop', 'public', 'assets']) {
    for (const entry of await hashFiles(path.join(root, directory))) result.push({ ...entry, file: `${directory}/${entry.file}` });
  }
  for (const file of ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'scripts/package-photoshop.mjs']) {
    const bytes = await readFile(path.join(root, file));
    result.push({ file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
export async function packagePhotoshop({ output = defaultOutput, skipZip = false } = {}) {
  if (process.platform !== 'win32' || process.release.name !== 'node' || process.arch !== 'x64') throw new Error('Build this Windows x64 package with standalone Node.js.');
  const sourceFiles = await sourceSnapshot();
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const cepManifest = renderManifest(await readFile(path.join(root, 'photoshop/CSXS/manifest.xml'), 'utf8'), version);
  const mainDist = await hashFiles(path.join(root, 'dist'));
  if (!mainDist.some(entry => entry.file === 'index.html')) throw new Error('Build the frozen main editor dist before packaging Photoshop.');
  const run = path.join(output, `build-${Date.now()}`);
  const bundle = path.join(run, `Zizao-Photoshop-${version}`);
  const extension = path.join(bundle, id);
  const editor = path.join(extension, 'packages/editor');
  await mkdir(editor, { recursive: true });
  for (const folder of ['CSXS', 'panel', 'jsx', 'runtime']) await cp(path.join(root, 'photoshop', folder), path.join(extension, folder), { recursive: true });
  await writeFile(path.join(extension, 'CSXS/manifest.xml'), cepManifest);
  for (const file of ['Install.ps1', 'Uninstall.ps1', 'Install.cmd', 'Uninstall.cmd', 'README.zh-CN.md']) await copyFile(path.join(root, 'photoshop', file), path.join(bundle, file));
  await build({ configFile: false, root, base: './', plugins: [react()], build: { outDir: path.join(editor, 'dist'), emptyOutDir: true, target: 'chrome99' } });
  const editorDist = await hashFiles(path.join(editor, 'dist'));
  await cp(path.join(root, 'server'), path.join(editor, 'server'), { recursive: true });
  await cp(path.join(root, 'assets'), path.join(editor, 'assets'), { recursive: true });
  await writeFile(path.join(editor, 'package.json'), JSON.stringify({ name: `${packageJson.name}-photoshop-runtime`, version, private: true, type: 'module', dependencies: packageJson.dependencies }, null, 2));
  const dependencies = await collectDependencies(path.join(root, 'package.json'));
  for (const dependency of dependencies) {
    await cp(dependency.directory, path.join(editor, 'node_modules', dependency.relative), { recursive: true, filter: file => !path.relative(dependency.directory, file).split(path.sep).includes('node_modules') });
  }
  await copyFile(process.execPath, path.join(extension, 'runtime/node.exe'));
  const license = path.join(root, 'photoshop/licenses', `node-${process.version}-LICENSE.txt`);
  try { await stat(license); }
  catch {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
    if (!response.ok) throw new Error(`Node license download returned HTTP ${response.status}`);
    const text = await response.text();
    if (!text.startsWith('Node.js is licensed') || text.length < 30000) throw new Error('Node license response is incomplete.');
    await mkdir(path.dirname(license), { recursive: true });
    await writeFile(license, text);
  }
  await copyFile(license, path.join(extension, 'runtime/LICENSE-Node.txt'));
  await writeFile(path.join(extension, 'THIRD-PARTY.json'), JSON.stringify({ runtime: { name: 'Node.js', version: process.version, license: 'runtime/LICENSE-Node.txt', source: `https://nodejs.org/dist/${process.version}/` }, packages: dependencies.map(({ name, version, license, relative }) => ({ name, version, license, directory: `packages/editor/node_modules/${relative}` })), fonts: 'packages/editor/assets/fonts/manifest.json' }, null, 2));
  if (snapshotDigest(sourceFiles) !== snapshotDigest(await sourceSnapshot())) throw new Error('Source files changed during packaging; rebuild from a frozen source tree.');
  if (snapshotDigest(mainDist) !== snapshotDigest(await hashFiles(path.join(root, 'dist')))) throw new Error('Main editor dist changed during packaging; wait for the final build.');
  const buildEvidence = { productName: '字造', version, target: 'chrome99', base: './', sourceSha256: snapshotDigest(sourceFiles), mainDist: { sha256: snapshotDigest(mainDist), files: mainDist }, editorDist: { sha256: snapshotDigest(editorDist), files: editorDist } };
  await writeFile(path.join(extension, 'build-evidence.json'), JSON.stringify(buildEvidence, null, 2));
  const files = await hashFiles(extension);
  await writeFile(path.join(extension, 'package-manifest.json'), JSON.stringify({ name: id, productName: '字造', version, builtAt: new Date().toISOString(), target: 'Windows x64, Photoshop 25.12–27.x / CEP 12', node: process.version, buildEvidence: 'build-evidence.json', sourceFiles, files }, null, 2));
  const report = { version, productName: '字造', bundle, extension, files: files.length, unpackedBytes: files.reduce((sum, file) => sum + file.size, 0), runtime: process.version, dependencies: dependencies.length, buildTarget: buildEvidence.target, sourceSha256: buildEvidence.sourceSha256, mainDistSha256: buildEvidence.mainDist.sha256, editorDistSha256: buildEvidence.editorDist.sha256 };
  if (!skipZip) {
    report.zip = path.join(run, `Zizao-Photoshop-${version}.zip`);
    await archive(bundle, report.zip);
    const bytes = await readFile(report.zip);
    report.zipBytes = bytes.length;
    report.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(report.zip + '.sha256', `${report.sha256}  ${path.basename(report.zip)}\n`);
  }
  await writeFile(path.join(run, 'release.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await packagePhotoshop({ skipZip: process.argv.includes('--skip-zip') });
