import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { chromium } from 'playwright';
import { outlineFont } from '../server/outline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'verification/letterforms');
await mkdir(destination, { recursive: true });
const require = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const code = ts.transpileModule(readFileSync(path.join(root, `src/${name}.ts`), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  new Function('require', 'module', 'exports', code)(specifier => specifier.startsWith('./') ? load(specifier.slice(2)) : require(specifier), module, module.exports);
  return module.exports;
}
const { LETTERFORM_PRESETS, applyLetterform, clearLetterform } = load('letterforms');
const engine = load('engine');
const { BASE_LAYER, DEFAULT_STYLE } = load('types');
const flat = { ...DEFAULT_STYLE, fill: '#25354d', gradient: false, strokeWidth: 0, outerWidth: 0, depth: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, texture: 'none', gloss: false };
const windowsFonts = `${process.env.WINDIR || 'C:/Windows'}/Fonts`;
const latin = fontkit.openSync(`${windowsFonts}/arial.ttf`);
const chinese = fontkit.openSync(`${windowsFonts}/msyh.ttc`).fonts[0];
const fonts = [{ key: 'latin', face: latin, text: 'AbgO B8', label: 'Arial · 拉丁' }, { key: 'cjk', face: chinese, text: '花体字造 回田', label: '微软雅黑 · 中文' }];
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function makeLayer(font, text) {
  const request = { fontId: font.postscriptName, text, fontSize: 160, letterSpacing: 8, lineHeight: 1.4, align: 'left', layout: 'horizontal' };
  const outline = outlineFont(font, request);
  assert.equal(outline.missing.length, 0);
  return { ...BASE_LAYER, ...request, ...outline, id: `proof-${font.postscriptName}`, name: text, kind: 'text', x: 900, y: 500, style: structuredClone(flat) };
}
const project = layer => ({ version: 1, name: '字造字形实测', width: 1800, height: 1000, layers: [layer] });
const options = { crop: true, scale: 1, padding: 12 };
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
function alphaEvidence(data, info) {
  assert.equal(info.channels, 4);
  let transparent = 0, filled = 0, edgeAlpha = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (alpha === 0) transparent++; else filled++;
    if (!x || !y || x === info.width - 1 || y === info.height - 1) edgeAlpha = Math.max(edgeAlpha, alpha);
  }
  assert.equal(edgeAlpha, 0);
  assert.ok(filled > 1000 && transparent > 1000);
  return { width: info.width, height: info.height, filled, transparent, edgeAlpha };
}
const entries = [{ id: 'source', name: '原始轮廓', category: 'source' }, ...LETTERFORM_PRESETS];
const cells = [], evidence = [], browserInputs = [];
for (const [row, entry] of entries.entries()) {
  for (const [column, font] of fonts.entries()) {
    const input = makeLayer(font.face, font.text);
    const layer = entry.id === 'source' ? input : applyLetterform(input, entry.id, 1);
    if (entry.id !== 'source') assert.deepEqual(clearLetterform(layer), input);
    const svg = engine.projectSvg(project(layer), options);
    const filename = `${entry.id}-${font.key}`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(path.join(destination, `${filename}.svg`), svg);
    await writeFile(path.join(destination, `${filename}.png`), png);
    const image = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    evidence.push({ preset: entry.id, font: font.face.postscriptName, text: font.text, amount: entry.id === 'source' ? 0 : 1, ...alphaEvidence(image.data, image.info), pngSha256: hash(png), sourceRestored: true });
    const thumb = await sharp(png).resize({ width: 695, height: 132, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    cells.push({ input: thumb.data, left: 305 + column * 755 + Math.floor((700 - thumb.info.width) / 2), top: 156 + row * 185 + Math.floor((132 - thumb.info.height) / 2) });
    if (entry.id !== 'source') browserInputs.push({ filename, layer });
  }
}
const sheetWidth = 1810, sheetHeight = 156 + entries.length * 185;
const labels = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">
<rect width="100%" height="100%" fill="#f8f6f1"/>
<text x="42" y="55" font-family="Microsoft YaHei, sans-serif" font-size="30" font-weight="bold" fill="#1e3044">字造 · 几何字形转换对照</text>
<text x="42" y="88" font-family="Microsoft YaHei, sans-serif" font-size="17" fill="#5e6c7b">真实轮廓 / 强度 100% / 单色填充 / 独立卷饰 / 原始字腔保留</text>
${fonts.map((font, column) => `<text x="${320 + column * 755}" y="131" font-family="Microsoft YaHei, sans-serif" font-size="19" fill="#314e66">${font.label} · ${font.text}</text>`).join('')}
${entries.map((entry, row) => `<rect x="24" y="${146 + row * 185}" width="1762" height="174" rx="12" fill="${row % 2 ? '#ffffff' : '#f0ede6'}"/><text x="44" y="${212 + row * 185}" font-family="Microsoft YaHei, sans-serif" font-size="23" fill="#25354d">${escape(entry.name)}</text><text x="44" y="${240 + row * 185}" font-family="Arial, sans-serif" font-size="14" fill="#7b8793">${entry.id}</text>`).join('')}
</svg>`;
await sharp(Buffer.from(labels)).composite(cells).png().toFile(path.join(destination, 'contact-sheet.png'));

const intensityFont = makeLayer(latin, 'AbgO');
const strengths = [0, 0.35, 0.7, 1];
const intensityRows = LETTERFORM_PRESETS.map(entry => `<tr><th>${escape(entry.name)}</th>${strengths.map(amount => {
  const proofId = `${entry.id}-${Math.round(amount * 100)}`;
  const input = { ...intensityFont, id: `intensity-${proofId}` };
  return `<td data-proof="${proofId}">${engine.projectSvg(project(applyLetterform(input, entry.id, amount)), options)}</td>`;
}).join('')}</tr>`).join('');
const html = `<!doctype html><meta charset="utf-8"><title>字造字形验证</title><style>body{margin:0;padding:28px;background:#f8f6f1;color:#25354d;font-family:"Microsoft YaHei",Arial,sans-serif}h1{font-size:26px;margin:0 0 8px}p{color:#607080}.sheet{display:block;width:100%;height:auto}table{border-collapse:collapse;width:100%;margin-top:20px;background:white}th,td{border:1px solid #dce2e7;padding:10px}td{width:21%;height:100px}td svg{width:100%;height:95px}th{font-size:15px}</style><h1>真实路径转换 · 花体 / 哥特</h1><p>几何算法在原轮廓上变换和添加装饰；不替换字体。通用字形处理不等同于逐字手写书法。</p><img class="sheet" src="contact-sheet.png" alt="十种字形中英对照"><h2>强度递进 · Arial</h2><table><thead><tr><th>样式</th><th>0%</th><th>35%</th><th>70%</th><th>100%</th></tr></thead><tbody>${intensityRows}</tbody></table>`;
await writeFile(path.join(destination, 'index.html'), html);
const executablePath = process.env.BROWSER_PATH || process.env.CHROME_PATH || [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const browserEvidence = [], intensityEvidence = [];
let referenceEvidence;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(destination, 'index.html')).href);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
  referenceEvidence = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    const uses = [...document.querySelectorAll('td svg use')];
    return {
      duplicateIds: ids.length - new Set(ids).size,
      references: uses.length,
      foreignReferences: uses.filter(use => document.getElementById(use.getAttribute('href').slice(1))?.closest('svg') !== use.closest('svg')).length,
    };
  });
  assert.equal(referenceEvidence.duplicateIds, 0);
  assert.equal(referenceEvidence.foreignReferences, 0);
  assert.ok(referenceEvidence.references >= 40);
  for (const entry of LETTERFORM_PRESETS) {
    const samples = [];
    for (const amount of strengths) {
      const proofId = `${entry.id}-${Math.round(amount * 100)}`;
      const png = await page.locator(`td[data-proof="${proofId}"] svg`).screenshot();
      samples.push({ amount, pngSha256: hash(png) });
    }
    assert.equal(new Set(samples.map(sample => sample.pngSha256)).size, 4, `${entry.id} intensity previews must differ`);
    intensityEvidence.push({ preset: entry.id, samples });
  }
  await page.screenshot({ path: path.join(destination, 'browser-contact-sheet.png'), fullPage: true });
  const engineCode = ts.transpileModule(await readFile(path.join(root, 'src/engine.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.addScriptTag({ content: `window.letterformEngine = (() => { const exports = {}; ${engineCode}; return exports; })();` });
  for (const item of browserInputs) {
    const base64 = await page.evaluate(async ({ layer, options }) => {
      const png = await window.letterformEngine.exportPng({ version: 1, name: '真实浏览器导出', width: 1800, height: 1000, layers: [layer] }, options);
      const bytes = new Uint8Array(await png.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, { layer: item.layer, options });
    const png = Buffer.from(base64, 'base64');
    const image = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    browserEvidence.push({ sample: item.filename, ...alphaEvidence(image.data, image.info), pngSha256: hash(png) });
    await writeFile(path.join(destination, `${item.filename}-browser.png`), png);
  }
} finally { await browser.close(); }
const report = {
  command: 'node scripts/verify-letterforms.mjs',
  fonts: fonts.map(font => ({ name: font.face.postscriptName, text: font.text })),
  styles: LETTERFORM_PRESETS.map(({ id, name, category }) => ({ id, name, category })),
  sharp: evidence, browser: browserEvidence, intensity: intensityEvidence, svgReferences: referenceEvidence,
  limitations: '通用轮廓变换保留原字体特征；卷饰独立可编辑，算法不是完整书法生成器。',
};
await writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Letterforms: ${LETTERFORM_PRESETS.length} presets; ${evidence.length} real-font SVG/PNG samples; ${browserEvidence.length} browser PNG exports; all borders alpha=0.`);
console.log(`Intensity previews: ${intensityEvidence.length * strengths.length}; duplicate SVG IDs=${referenceEvidence.duplicateIds}; foreign references=${referenceEvidence.foreignReferences}; 4 distinct strengths per preset.`);
console.log(`Contact sheet: ${path.join(destination, 'contact-sheet.png')}`);
console.log(`Browser screenshot: ${path.join(destination, 'browser-contact-sheet.png')}`);
console.log(`Report: ${path.join(destination, 'report.json')}`);
