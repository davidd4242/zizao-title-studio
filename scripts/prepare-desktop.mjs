import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const target = new URL('../desktop/', import.meta.url);
await mkdir(target, { recursive: true });
const source = new URL('../public/logo.png', import.meta.url);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(fileURLToPath(source)).resize(size, size, { fit: 'contain' }).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const start = 6 + index * 16;
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], start);
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], start + 1);
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(image.length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += image.length;
});
await writeFile(new URL('icon.ico', target), Buffer.concat([header, ...images]));
console.log(`Desktop icon: ${sizes.join(', ')}px; ${offset} bytes`);

const logo = (await readFile(source)).toString('base64');
const splash = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs><filter id="blur"><feGaussianBlur stdDeviation="4"/></filter></defs>
<rect width="640" height="360" fill="#f7f7f5"/>
<g opacity=".48" filter="url(#blur)">
  <path fill="#fff" d="M0 0h640v40H0zM0 40h130v320H0zM510 40h130v320H510zM171 92h298v213H171z"/>
  <path stroke="#e6e6e6" d="M0 40h640M130 40v320M510 40v320"/>
  <g fill="#dedede"><rect x="24" y="16" width="64" height="8" rx="2"/><rect x="26" y="77" width="74" height="8" rx="2"/><rect x="26" y="108" width="78" height="25" rx="3"/><rect x="26" y="150" width="78" height="25" rx="3"/><rect x="534" y="77" width="74" height="8" rx="2"/><rect x="534" y="108" width="78" height="25" rx="3"/><rect x="534" y="150" width="78" height="25" rx="3"/></g>
  <rect x="568" y="11" width="48" height="20" rx="4" fill="#c5b0f4"/>
</g>
<rect x="202" y="62" width="236" height="236" rx="24" fill="#fff" stroke="#e6e6e6"/>
<image href="data:image/png;base64,${logo}" x="296" y="85" width="48" height="48"/>
<circle cx="320" cy="160" r="10" fill="none" stroke="#e6e6e6" stroke-width="2"/>
<path d="M320 150a10 10 0 0 1 10 10" fill="none" stroke="#c5b0f4" stroke-width="2" stroke-linecap="round"/>
<g font-family="Microsoft YaHei, Segoe UI, sans-serif" text-anchor="middle">
  <text x="320" y="202" fill="#000000" font-size="21" font-weight="600">正在加载中</text>
  <text x="320" y="228" fill="#767676" font-size="12">字造 · 正在解压应用资源</text>
  <text x="320" y="270" fill="#999" font-size="11">窗口将自动打开</text>
</g></svg>`);
const { data: rgb, info } = await sharp(splash).flatten({ background: '#f7f7f5' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
// NSIS BgImage expects BMP; Sharp provides RGB pixels but has no BMP encoder.
const rowBytes = Math.ceil(info.width * 3 / 4) * 4;
const bitmap = Buffer.alloc(54 + rowBytes * info.height);
bitmap.write('BM');
bitmap.writeUInt32LE(bitmap.length, 2);
bitmap.writeUInt32LE(54, 10);
bitmap.writeUInt32LE(40, 14);
bitmap.writeInt32LE(info.width, 18);
bitmap.writeInt32LE(info.height, 22);
bitmap.writeUInt16LE(1, 26);
bitmap.writeUInt16LE(24, 28);
bitmap.writeUInt32LE(rowBytes * info.height, 34);
bitmap.writeInt32LE(3780, 38);
bitmap.writeInt32LE(3780, 42);
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const input = (y * info.width + x) * 3;
    const output = 54 + (info.height - y - 1) * rowBytes + x * 3;
    bitmap[output] = rgb[input + 2];
    bitmap[output + 1] = rgb[input + 1];
    bitmap[output + 2] = rgb[input];
  }
}
await writeFile(new URL('splash.bmp', target), bitmap);
const preview = new URL('../verification/startup/', import.meta.url);
await mkdir(preview, { recursive: true });
await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(fileURLToPath(new URL('splash-preview.png', preview)));
console.log(`Portable splash: ${info.width}x${info.height}; ${bitmap.length} bytes; BMP 24-bit`);
