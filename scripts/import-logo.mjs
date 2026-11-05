import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
assert.ok(input, 'Usage: node scripts/import-logo.mjs SOURCE_IMAGE');
const out = path.join(root, 'verification', 'logo');
await mkdir(out, { recursive: true });
const source = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.equal(source.info.width, source.info.height, 'The supplied logo must be square');
const logo = path.join(root, 'public', 'logo.png');
await sharp(source.data, { raw: source.info }).png().toFile(logo);
const actual = await sharp(logo).ensureAlpha().raw().toBuffer();
assert.deepEqual(actual, source.data, 'Logo import must preserve every RGBA pixel');
await sharp(logo).resize(48, 48, { fit: 'contain' }).png().toFile(path.join(root, 'public', 'favicon.png'));
const embedded = (await sharp(logo).png().toBuffer()).toString('base64');
await writeFile(path.join(root, 'public', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><image width="200" height="200" href="data:image/png;base64,${embedded}"/></svg>\n`);
await sharp(logo).flatten({ background: '#ffffff' }).png().toFile(path.join(out, 'logo-on-white.png'));
let transparent = 0, painted = 0;
for (let i = 3; i < actual.length; i += 4) { if (actual[i] === 0) transparent++; else painted++; }
assert.ok(transparent > 0 && painted > 0, 'Logo must retain painted and transparent pixels');
const report = { sourceDimensions: [source.info.width, source.info.height], rgbaSha256: createHash('sha256').update(actual).digest('hex'), sourcePixelDifference: 0, transparent, painted, outputs: ['public/logo.png', 'public/favicon.png', 'public/favicon.svg'] };
await writeFile(path.join(out, 'import-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
