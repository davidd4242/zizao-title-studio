import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const asset = path => new URL(`../${path}`, import.meta.url);
const logo = await readFile(asset('public/logo.png'));
const pixels = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test('supplied logo preserves all 200px RGBA pixels and transparent cutouts', () => {
  assert.equal(pixels.info.width, 200);
  assert.equal(pixels.info.height, 200);
  assert.equal(createHash('sha256').update(pixels.data).digest('hex'), 'c5d8085ddfba307328b69517379e4539891efce2aa3eaefe1446ed6954f4482a');
  let transparent = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] === 0) transparent++;
  assert.equal(transparent, 6157);
});

test('PNG and SVG favicons derive from the same supplied logo without cropping', async () => {
  const favicon = await sharp(await readFile(asset('public/favicon.png'))).ensureAlpha().raw().toBuffer();
  const expected = await sharp(logo).resize(48, 48, { fit: 'contain' }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(favicon, expected);
  const svg = await readFile(asset('public/favicon.svg'), 'utf8');
  const embedded = svg.match(/href="data:image\/png;base64,([^"]+)"/);
  assert.ok(embedded);
  assert.deepEqual(await sharp(Buffer.from(embedded[1], 'base64')).ensureAlpha().raw().toBuffer(), pixels.data);
});

test('all seven native ICO sizes render the supplied logo exactly', async () => {
  const ico = await readFile(asset('desktop/icon.ico'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  for (const [i, size] of sizes.entries()) {
    const entry = 6 + i * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    const actual = await sharp(ico.subarray(offset, offset + length)).ensureAlpha().raw().toBuffer();
    const expected = await sharp(logo).resize(size, size, { fit: 'contain' }).ensureAlpha().raw().toBuffer();
    assert.deepEqual(actual, expected, `${size}px native icon`);
  }
});

test('built UI, early loading screens and favicon use the final logo assets', async () => {
  assert.deepEqual(await readFile(asset('dist/logo.png')), logo);
  assert.deepEqual(await readFile(asset('dist/favicon.png')), await readFile(asset('public/favicon.png')));
  for (const file of ['index.html', 'src/App.tsx', 'src/StartupOverlay.tsx']) {
    assert.match(await readFile(asset(file), 'utf8'), /src="\/logo\.png"/, file);
  }
  const desktop = await readFile(asset('desktop/loading.html'), 'utf8');
  assert.match(desktop, /class="brand" src="icon\.ico"/);
});
