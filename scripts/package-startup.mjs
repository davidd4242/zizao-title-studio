import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath, stat, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fileHash, inspectRuntime, inventory, manifestSummary, extractAndVerify } from './package-startup-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
assert.ok(args.includes('--final-startup-build-ready'), 'Archive only a frozen build: pass --final-startup-build-ready');
const version = option('--version'); assert.ok(version, 'Pass --version explicitly');
const input = await realpath(path.resolve(option('--input') || path.join(root, 'release/win-unpacked')));
const destination = option('--output') ? path.resolve(option('--output')) : null;
const evidence = path.join(root, 'verification/startup-speed', `package-${Date.now()}`);
const archiveDirectory = path.join(evidence, 'archive');
await mkdir(archiveDirectory, { recursive: true });
const report = { ok: false, version, startedAt: new Date().toISOString(), input, evidence, checks: [] };
const check = label => { report.checks.push(label); console.log(`PASS ${label}`); };
try {
  const config = require('../desktop/builder.cjs');
  assert.equal(config.executableName, '字造');
  assert.equal(config.productName, '字造');
  assert.equal(config.asar, false);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, 'Source and requested release versions must agree');
  const before = await inspectRuntime(input, '字造.exe', version);
  assert.ok(before.files.length > 100, 'Expected complete Electron directory');
  assert.ok(!before.files.some(file => /^resources\/app\/(?:verification|tests|src|data)\//.test(file.path)), 'Private/source test files are excluded');
  report.inputManifest = path.join(evidence, 'input-manifest.json');
  await writeFile(report.inputManifest, JSON.stringify(before.files, null, 2));
  report.inputSummary = before.summary;
  report.inputExecutable = before.executable;
  report.runtimePackage = before.package;
  check('Input runtime is complete, versioned, link-free and free of duplicate Windows paths');
  const byPath = new Map(before.files.map(file => [file.path, file]));
  const source = {};
  for (const name of ['dist', 'assets/fonts']) {
    const sourceFiles = await inventory(path.join(root, name));
    const packedFiles = before.files.filter(file => file.path.startsWith(`resources/app/${name}/`)).map(file => ({ ...file, path: file.path.slice(`resources/app/${name}/`.length) }));
    assert.deepEqual(packedFiles, sourceFiles, `Frozen ${name} differs from packaged runtime`);
    source[name] = manifestSummary(sourceFiles);
  }
  for (const name of ['desktop/main.cjs', 'desktop/loading.html', 'desktop/icon.ico', 'server/index.mjs', 'server/font-worker.mjs', 'server/outline.mjs']) {
    const sha = await fileHash(path.join(root, name));
    assert.equal(byPath.get(`resources/app/${name}`)?.sha256, sha, `Frozen runtime code differs: ${name}`);
    source[name] = sha;
  }
  report.source = source;
  check('Actual packaged app, fonts and service bytes match the frozen source and dist');
  console.log(`INPUT ${JSON.stringify({ files: before.summary.files, bytes: before.summary.bytes, sha256: before.summary.sha256, duplicateContentGroups: before.summary.duplicateContent.length })}`);
  const { build, Platform, Arch } = require('electron-builder');
  const artifacts = await build({
    projectDir: root,
    prepackaged: input,
    targets: Platform.WINDOWS.createTarget('zip', Arch.x64),
    publish: 'never',
    config: { ...config, directories: { ...config.directories, output: archiveDirectory }, win: { ...config.win, target: [{ target: 'zip', arch: ['x64'] }], artifactName: '字造-免安装.zip' }, artifactName: '字造-免安装.zip' },
  });
  const archive = path.join(archiveDirectory, '字造-免安装.zip');
  assert.ok(artifacts.some(file => path.resolve(file) === path.resolve(archive)), 'Official archive target returned expected ZIP');
  assert.deepEqual(await inventory(input), before.files, 'Archiving changed input runtime');
  check('Official electron-builder ZIP target archived the existing runtime without rebuilding or altering it');
  const extracted = path.join(evidence, '字造-免安装');
  report.extracted = await extractAndVerify(archive, before.files, extracted, evidence);
  report.extractedManifest = path.join(evidence, 'extracted-manifest.json');
  check('ZIP has no duplicate or escaping paths and every extracted file matches input size and SHA256');
  const archiveStat = await stat(archive);
  report.archive = { path: archive, size: archiveStat.size, sha256: await fileHash(archive) };
  report.executable = path.join(extracted, '字造.exe');
  if (destination) {
    assert.equal(path.basename(destination), '字造-免安装.zip', 'The official output name is fixed');
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(archive, destination, constants.COPYFILE_EXCL);
    assert.equal(await fileHash(destination), report.archive.sha256);
    report.publishedArchive = { ...report.archive, path: destination };
    check('Requested release ZIP copied without overwriting an existing artifact and retained identical bytes');
  }
  report.ok = true;
} catch (error) { report.error = error.stack || String(error); console.error(report.error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, zip: report.publishedArchive?.path || report.archive?.path, executable: report.executable, report: path.join(evidence, 'report.json') }));
}
