import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(await readFile(path.join(root, 'verification/photoshop/release/latest.json'), 'utf8'));
const destination = path.resolve(process.argv[2] || path.resolve(root, '..'), '字造-Photoshop插件.zip');
await mkdir(path.dirname(destination), { recursive: true });
async function hash(file) { const digest = createHash('sha256'); for await (const bytes of createReadStream(file)) digest.update(bytes); return digest.digest('hex'); }
const before = await hash(release.zip);
if (before !== release.sha256) throw new Error('Verified package hash changed before delivery.');
try { await copyFile(release.zip, destination, constants.COPYFILE_EXCL); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const after = await hash(destination);
if (after !== before) throw new Error('Destination contains different bytes; no overwrite performed.');
const result = { file: destination, bytes: (await stat(destination)).size, sha256: after, version: release.version, format: 'Windows x64 Photoshop CEP 12' };
await writeFile(path.join(root, 'verification/photoshop', `delivery-manifest-${release.version}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
