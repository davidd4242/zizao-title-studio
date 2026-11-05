import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, 'release', '字造.exe');
const destination = path.resolve(process.argv[2] || path.resolve(root, '..'), path.basename(source));
await mkdir(path.dirname(destination), { recursive: true });
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
const before = await hash(source);
try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const after = await hash(destination);
if (before !== after) throw new Error('Destination already exists with different contents; no overwrite performed.');
const result = { file: destination, bytes: (await stat(destination)).size, sha256: after, platform: 'Windows x64', version };
await mkdir(path.join(root, 'verification', 'desktop'), { recursive: true });
await writeFile(path.join(root, 'verification', 'desktop', `release-manifest-${version}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
