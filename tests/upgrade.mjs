import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { initializeCanvas, readPsd } from 'ag-psd';
import { start } from '../server/index.mjs';

// ag-psd's useImageData decoder needs an RGBA allocator in Node, not a DOM canvas.
initializeCanvas(() => { throw new Error('Unexpected canvas allocation during raw PSD decoding'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

// Drive the built application only. Source loading supplies expected catalog data,
// never substitutes for the UI handlers or the export implementations under test.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'verification', 'upgrade');
const require = createRequire(import.meta.url);
const modules = new Map();
function sourceModule(relative) {
  const file = path.resolve(root, 'src', `${relative.replace(/\.ts$/, '')}.ts`);
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} };
  modules.set(file, module.exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(specifier => specifier.startsWith('.') ? sourceModule(path.relative(path.join(root, 'src'), path.resolve(path.dirname(file), specifier))) : require(specifier), module, module.exports);
  return module.exports;
}
const { STYLE_PRESETS, STICKERS } = sourceModule('presets');
const { LETTERFORM_PRESETS } = sourceModule('letterforms');
assert.equal(STYLE_PRESETS.length, 200);
assert.equal(STICKERS.length, 400);
assert.equal(LETTERFORM_PRESETS.length, 10);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const artifact = name => path.join(output, name);
const report = { started: new Date().toISOString(), cases: [], checks: [], errors: [], artifacts: [], sourceHashes: {}, browser: '', url: '' };
const evidenceInputs = ['tests/upgrade.mjs', 'src/App.tsx', 'src/Canvas.tsx', 'src/Controls.tsx', 'src/CatalogPanel.tsx', 'src/StickerDragLayer.tsx', 'src/LetterformControls.tsx', 'src/ExportControls.tsx', 'src/psd.ts', 'src/layer-actions.ts', 'assets/fonts/manifest.json', 'dist/index.html',
  ...readdirSync(path.join(root, 'dist', 'assets'), { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `dist/assets/${entry.name}`)];
for (const relative of evidenceInputs) report.sourceHashes[relative] = hash(readFileSync(path.join(root, relative)));
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(output, '.data-'));
let server, browser;
const only = process.env.UPGRADE_CASE?.split(',').filter(Boolean);
let active = '';
function check(label, condition, detail) {
  assert.ok(condition, `${active}: ${label}${detail ? `: ${JSON.stringify(detail)}` : ''}`);
  report.checks.push({ case: active, label, ...(detail ? { detail } : {}) });
  console.log(`PASS [${active}] ${label}`);
}
async function idle(page) {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="state-marker"]');
    return state?.dataset.loading === 'false' && state.dataset.dirty === 'false' && state.dataset.busy === '';
  }, null, { timeout: 12000 });
}
async function download(page, locator, name) {
  const pending = page.waitForEvent('download', { timeout: 15000 });
  await locator.click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  if (name) {
    await file.saveAs(artifact(name));
    report.artifacts.push(name);
  }
  const bytes = await readFile(await file.path());
  if (!name) await file.delete();
  return { bytes, suggested: file.suggestedFilename() };
}
async function project(page) {
  await idle(page);
  // The real Save action returns current React state, without racing its 500ms autosave.
  const button = page.locator('.header-actions').getByRole('button', { name: '保存工程', exact: true });
  return JSON.parse((await download(page, button)).bytes.toString('utf8'));
}
async function undo(page) {
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click();
  await idle(page);
}
async function section(page, title) {
  const target = page.locator('details.property-section').filter({ has: page.locator('summary').filter({ hasText: title }) });
  if (!await target.evaluate(node => node.open)) await target.locator('summary').click();
  return target;
}
async function rail(page, name) { await page.locator('.rail').getByRole('button', { name, exact: true }).click(); }
async function capture(page, name) {
  await page.screenshot({ path: artifact(name), fullPage: true });
  report.artifacts.push(name);
}
async function alpha(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, painted = 0, partial = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) clear++; else painted++; if (data[i] > 0 && data[i] < 255) partial++; }
  return { width: info.width, height: info.height, clear, painted, partial, hash: hash(data) };
}
async function caseRun(name, run, viewport = { width: 1600, height: 1000 }) {
  if (only && !only.includes(name)) return;
  active = name;
  const context = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [], network = [];
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) errors.push({ type: 'http', status: response.status(), url: response.url() }); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) errors.push({ type: 'requestfailed', message: request.failure()?.errorText, url: request.url() }); });
  page.on('response', response => { if (response.url().endsWith('/api/outline')) network.push(response.json().then(result => ({ request: response.request().postDataJSON(), result }))); });
  const began = Date.now();
  try {
    await page.goto(report.url, { waitUntil: 'networkidle' });
    await idle(page);
    await run(page, network);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    check('真实浏览器无 console、pageerror 或 HTTP 错误', true);
    report.cases.push({ name, status: 'passed', elapsedMs: Date.now() - began });
  } catch (error) {
    const failure = { name, status: 'failed', message: error.message, stack: error.stack, errors, elapsedMs: Date.now() - began };
    report.cases.push(failure);
    report.errors.push(failure);
    console.error(`FAIL [${name}] ${error.stack}`);
    await capture(page, `${name}-failure.png`).catch(() => {});
    await writeFile(artifact(`${name}-failure.html`), await page.content()).catch(() => {});
  } finally {
    await context.close();
    await writeFile(artifact('results.json'), JSON.stringify(report, null, 2));
  }
}

async function catalogCase(page, kind, expected, pageSize) {
  const isStyle = kind === 'styles', noun = isStyle ? '风格' : '装饰';
  await rail(page, noun);
  const panel = page.getByTestId(`${kind}-catalog`);
  const cards = panel.locator(isStyle ? '.preset-card' : '.sticker-card');
  const names = () => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  const labels = entries => entries.map(item => `${isStyle ? '应用风格' : '添加装饰'} ${item.name}`);
  const category = page.getByLabel(`${noun}分类`, { exact: true });
  check(`${noun}总数准确`, (await panel.getByTestId('catalog-total').innerText()).startsWith(String(expected.length)));
  const categories = [...new Set(expected.map(item => item.category))];
  assert.deepEqual(await category.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['', ...categories]);
  const seen = [];
  const pages = Math.ceil(expected.length / pageSize);
  for (let index = 0; index < pages; index++) {
    const actual = await names();
    assert.deepEqual(actual, labels(expected.slice(index * pageSize, (index + 1) * pageSize)), `${noun} page ${index + 1}`);
    assert.equal(await panel.locator('.catalog-results span').last().innerText(), `${index + 1} / ${pages}`);
    seen.push(...actual);
    if (index + 1 < pages) await panel.getByRole('button', { name: '下一页', exact: true }).click();
  }
  check(`${noun}每页条目与完整目录一致且无重复`, seen.length === expected.length && new Set(seen).size === expected.length, { total: seen.length, pages, pageSize });
  check(`${noun}最后一页禁用下一页`, await panel.getByRole('button', { name: '下一页', exact: true }).isDisabled());
  await panel.getByRole('button', { name: '上一页', exact: true }).click();
  assert.deepEqual(await names(), labels(expected.slice((pages - 2) * pageSize, (pages - 1) * pageSize)));
  for (const value of categories) {
    await category.selectOption(value);
    const matches = expected.filter(item => item.category === value);
    assert.deepEqual(await names(), labels(matches.slice(0, pageSize)), `${noun} category ${value}`);
    assert.equal(await panel.locator('.catalog-results span').first().innerText(), `找到 ${matches.length} ${isStyle ? '种风格' : '个装饰'}`);
    assert.equal(await panel.locator('.catalog-results span').last().innerText(), `1 / ${Math.ceil(matches.length / pageSize)}`);
  }
  check(`${noun}所有分类过滤并重置分页`, true, { categories: categories.length });
  await category.selectOption('');
  const query = isStyle ? '奶油 甜美' : '星星 宇宙';
  await page.getByLabel(`搜索${noun}`, { exact: true }).fill(query);
  const matches = expected.filter(item => query.split(/\s+/).every(term => `${item.name} ${item.category} ${item.tags.join(' ')} ${item.description || ''}`.includes(term)));
  assert.ok(matches.length > 0);
  assert.deepEqual(await names(), labels(matches.slice(0, pageSize)));
  assert.equal(await panel.locator('.catalog-results span').first().innerText(), `找到 ${matches.length} ${isStyle ? '种风格' : '个装饰'}`);
  check(`${noun}多关键词搜索结果准确`, true, { query, matched: matches.length });
  await page.getByLabel(`搜索${noun}`, { exact: true }).fill(expected.at(-1).name);
  assert.deepEqual(await names(), labels(expected.filter(item => `${item.name} ${item.category} ${item.tags.join(' ')} ${item.description || ''}`.includes(expected.at(-1).name)).slice(0, pageSize)));
  await page.getByLabel(`搜索${noun}`, { exact: true }).fill('qa-no-match-194728');
  assert.equal(await cards.count(), 0);
  check(`${noun}空搜索展示空态`, await panel.locator('.catalog-empty').isVisible());
  await panel.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.deepEqual(await names(), labels(expected.slice(0, pageSize)));
  await capture(page, `${kind}-catalog.png`);
}

try {
  server = await start({ port: 0, host: '127.0.0.1', staticDir: path.join(root, 'dist'), dataDir, includeSystemFonts: false, scanRegistry: false, fontDirectories: [] });
  report.url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  report.browser = await browser.version();
  console.log(`UPGRADE TEST ${report.url}; Edge ${report.browser}; isolated bundled-font server`);

  await caseRun('styles-catalog', page => catalogCase(page, 'styles', STYLE_PRESETS, 12));
  await caseRun('stickers-catalog', page => catalogCase(page, 'stickers', STICKERS, 24));

  await caseRun('glyph-stroke', async page => {
    const original = await project(page), id = original.layers.at(-1).id;
    check('默认打开逐字模式', await page.getByRole('button', { name: '逐字排版', exact: true }).evaluate(node => node.classList.contains('active')));
    const glyph = page.locator('.glyph-target[data-glyph-index="1"]');
    const box = await glyph.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 23, box.y + box.height / 2 + 13, { steps: 6 });
    await page.mouse.up();
    const after = await project(page), beforeLayer = original.layers.find(layer => layer.id === id), changedLayer = after.layers.find(layer => layer.id === id);
    const changed = changedLayer.glyphs.flatMap((value, index) => JSON.stringify(value) === JSON.stringify(beforeLayer.glyphs[index]) ? [] : [index]);
    assert.deepEqual(changed, [1]);
    assert.deepEqual([changedLayer.x, changedLayer.y, changedLayer.rotation, changedLayer.scaleX, changedLayer.scaleY], [beforeLayer.x, beforeLayer.y, beforeLayer.rotation, beforeLayer.scaleX, beforeLayer.scaleY]);
    assert.deepEqual(after.layers.filter(layer => layer.id !== id), original.layers.filter(layer => layer.id !== id));
    assert.deepEqual(changedLayer.glyphs[1].commands, beforeLayer.glyphs[1].commands);
    check('鼠标拖单字只移动该字，整层与其他字保持原位', true);
    await undo(page); assert.deepEqual(await project(page), original);
    check('单字移动一键撤销还原', await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).isDisabled());
    await section(page, '贴纸描边');
    for (const [label, property] of [['内描边宽度', 'strokeWidth'], ['外描边宽度', 'outerWidth']]) {
      const baseline = await project(page);
      const slider = page.getByRole('slider', { name: label, exact: true });
      await slider.scrollIntoViewIfNeeded();
      const sliderBox = await slider.boundingBox(); assert.ok(sliderBox);
      const history = await page.getByTestId('state-marker').getAttribute('data-history');
      const artwork = page.getByTestId('artboard').locator(`.movable-art[data-layer-id="${id}"]`);
      const initialSvg = await artwork.innerHTML();
      await page.mouse.move(sliderBox.x + sliderBox.width * 0.42, sliderBox.y + sliderBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(sliderBox.x + sliderBox.width * 0.65, sliderBox.y + sliderBox.height / 2, { steps: 6 });
      const liveValue = Number(await slider.inputValue());
      check(`${label}按住拖动时更新真实 SVG`, await artwork.innerHTML() !== initialSvg && liveValue !== baseline.layers.find(layer => layer.id === id).style[property]);
      assert.equal(await page.getByTestId('state-marker').getAttribute('data-history'), history, 'preview must not record intermediate history');
      await capture(page, `${property}-live.png`);
      await page.mouse.up();
      const committed = await project(page);
      assert.equal(committed.layers.find(layer => layer.id === id).style[property], liveValue);
      assert.equal(Number(await page.getByTestId('state-marker').getAttribute('data-history')), Number(history) + 1);
      await undo(page); assert.deepEqual(await project(page), baseline);
      check(`${label}一次拖动仅记录一次撤销`, await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).isDisabled());
    }
    await capture(page, 'glyph-stroke.png');
  });

  await caseRun('sticker-drag', async page => {
    const initial = await project(page);
    async function begin() {
      await rail(page, '装饰');
      const card = page.locator('.sticker-card').first();
      await card.scrollIntoViewIfNeeded();
      const b = await card.boundingBox(); assert.ok(b);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 14, b.y + b.height / 2 + 3, { steps: 3 });
      await page.getByTestId('sticker-drag-preview').waitFor({ state: 'visible' });
      return card.getAttribute('data-sticker-id');
    }
    async function finishOne(label, target, expectedPosition, afterId) {
      const before = await project(page);
      await begin();
      await page.mouse.move(target.x, target.y, { steps: 10 });
      assert.notEqual(await page.getByTestId('sticker-drag-preview').getAttribute('data-target'), 'none');
      await page.mouse.up();
      await page.getByTestId('sticker-drag-preview').waitFor({ state: 'detached' });
      const after = await project(page), inserted = after.layers.filter(layer => !before.layers.some(old => old.id === layer.id));
      assert.equal(after.layers.length, before.layers.length + 1);
      assert.equal(inserted.length, 1);
      assert.equal(inserted[0].kind, 'sticker');
      assert.deepEqual(after.layers.filter(layer => layer.id !== inserted[0].id), before.layers);
      if (expectedPosition) {
        assert.ok(Math.abs(inserted[0].x - expectedPosition.x) < 1);
        assert.ok(Math.abs(inserted[0].y - expectedPosition.y) < 1);
      }
      if (afterId) assert.equal(after.layers.findIndex(layer => layer.id === inserted[0].id), after.layers.findIndex(layer => layer.id === afterId) + 1);
      check(`${label}一次落点只新增一个可编辑装饰`, true);
      await undo(page); assert.deepEqual(await project(page), before);
      check(`${label}一次撤销恢复原图层`, true);
    }
    const board = await page.getByTestId('artboard').boundingBox(); assert.ok(board);
    await finishOne('画布落点', { x: board.x + board.width * 0.62, y: board.y + board.height * 0.38 }, { x: initial.width * 0.62, y: initial.height * 0.38 });
    await rail(page, '装饰');
    const shortcut = await page.getByTestId('layer-drop-shortcut').boundingBox(); assert.ok(shortcut);
    await finishOne('图层快捷区', { x: shortcut.x + shortcut.width / 2, y: shortcut.y + shortcut.height / 2 }, { x: initial.width / 2, y: initial.height / 2 });
    const beforeHover = await project(page);
    await begin();
    const tab = await page.locator('[data-layers-tab]').boundingBox(); assert.ok(tab);
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2, { steps: 8 });
    await page.getByTestId('layer-drop-area').waitFor({ state: 'visible', timeout: 2000 });
    check('拖动悬停图层标签真实切换面板', await page.getByTestId('sticker-drag-preview').isVisible());
    const row = page.locator('.layer-row').nth(2), targetId = await row.getAttribute('data-layer-drop-id'), rb = await row.boundingBox(); assert.ok(rb);
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 6 });
    await page.mouse.up();
    const afterHover = await project(page), inserted = afterHover.layers.filter(layer => !beforeHover.layers.some(old => old.id === layer.id));
    assert.equal(inserted.length, 1); assert.equal(afterHover.layers.length, beforeHover.layers.length + 1);
    assert.equal(afterHover.layers.findIndex(layer => layer.id === inserted[0].id), afterHover.layers.findIndex(layer => layer.id === targetId) + 1);
    check('图层行落点按目标层级插入一层', true);
    await undo(page); assert.deepEqual(await project(page), beforeHover);
    for (const cancel of ['outside', 'escape']) {
      const before = await project(page), history = await page.getByTestId('state-marker').getAttribute('data-history');
      await begin();
      if (cancel === 'outside') {
        const top = await page.locator('.brand').boundingBox(); assert.ok(top);
        await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2, { steps: 8 });
        assert.equal(await page.getByTestId('sticker-drag-preview').getAttribute('data-target'), 'none');
      } else {
        await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2, { steps: 8 });
        await page.keyboard.press('Escape');
      }
      await page.mouse.up();
      await page.getByTestId('sticker-drag-preview').waitFor({ state: 'detached' });
      assert.deepEqual(await project(page), before);
      assert.equal(await page.getByTestId('state-marker').getAttribute('data-history'), history);
      check(`${cancel === 'outside' ? '拖到外面' : 'Escape'}取消时不增层、不增撤销记录`, true);
    }
    await capture(page, 'sticker-drag.png');
  });

  await caseRun('font-filter', async (page, network) => {
    const response = await page.request.get(`${report.url}/api/fonts`); assert.equal(response.status(), 200);
    const catalog = await response.json();
    check('隔离服务仅返回完整内置字库', catalog.fonts.length === 55 && catalog.fonts.every(font => font.bundled));
    await page.getByLabel('字体来源', { exact: true }).selectOption('bundled');
    const selected = (await project(page)).layers.at(-1).fontId;
    for (const [language, count] of [['zh-Hans', 11], ['zh-Hant', 9], ['en', 55], ['chinese', 15]]) {
      await page.getByLabel('字体语言', { exact: true }).selectOption(language);
      const expected = catalog.fonts.filter(font => language === 'chinese' ? font.hasChinese : font.languages.includes(language));
      assert.equal(expected.length, count);
      assert.match(await page.locator('.font-caption').innerText(), new RegExp(`${count} 款匹配`));
      const ids = await page.getByLabel('选择字体', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      assert.deepEqual(ids.sort(), [...new Set([...expected.map(font => font.id), selected])].sort());
      check(`内置 ${language} 过滤完整且保留当前字体回退项`, true, { count });
    }
    await page.getByLabel('字体语言', { exact: true }).selectOption('zh-Hant');
    await page.getByLabel('搜索字体', { exact: true }).fill('Huninn');
    const hant = catalog.fonts.find(font => font.family === 'Huninn'); assert.ok(hant);
    await page.getByLabel('标题文字', { exact: true }).fill('臺灣繁體快樂');
    await page.getByLabel('选择字体', { exact: true }).selectOption(hant.id);
    let current = (await project(page)).layers.at(-1);
    assert.equal(current.fontId, hant.id); assert.equal(current.text, '臺灣繁體快樂');
    assert.ok(current.glyphs.every(glyph => glyph.commands.length));
    check('繁体筛选可实际选择并生成繁体轮廓', true);
    await page.getByLabel('字体语言', { exact: true }).selectOption('en');
    await page.getByLabel('搜索字体', { exact: true }).fill('Anton');
    const english = catalog.fonts.find(font => font.family === 'Anton'); assert.ok(english);
    await page.getByLabel('标题文字', { exact: true }).fill('COVER STUDIO');
    await page.getByLabel('选择字体', { exact: true }).selectOption(english.id);
    current = (await project(page)).layers.at(-1);
    assert.equal(current.fontId, english.id); assert.equal(current.text, 'COVER STUDIO');
    assert.ok(current.glyphs.filter(glyph => glyph.char.trim()).every(glyph => glyph.commands.length));
    const outlines = await Promise.all(network);
    const tested = outlines.filter(item => [hant.id, english.id].includes(item.request.fontId));
    assert.equal(tested.length, 2);
    assert.ok(tested.every(item => item.result.missing.length === 0));
    check('英文筛选选择真实英文字体且无缺字', true);
    await page.getByLabel('字体来源', { exact: true }).selectOption('local');
    assert.match(await page.locator('.font-caption').innerText(), /0 款匹配/);
    check('本机筛选不混入内置字体', true);
    await capture(page, 'font-filter.png');
  });

  await caseRun('letterforms', async page => {
    const initial = await project(page), id = initial.layers.at(-1).id, original = initial.layers.at(-1);
    const originalCommands = hash(original.glyphs.map(glyph => glyph.commands));
    const variants = [];
    await section(page, '花体与哥特字形');
    for (const category of ['flourish', 'gothic']) {
      await page.getByRole('button', { name: category === 'flourish' ? '花体 · 5 款' : '哥特 · 5 款', exact: true }).click();
      const expected = LETTERFORM_PRESETS.filter(preset => preset.category === category);
      assert.equal(expected.length, 5);
      assert.deepEqual(await page.locator('[data-letterform-id]').evaluateAll(nodes => nodes.map(node => node.dataset.letterformId)), expected.map(preset => preset.id));
      for (const preset of expected) {
        await page.locator(`[data-letterform-id="${preset.id}"]`).click();
        const current = (await project(page)).layers.find(layer => layer.id === id);
        assert.equal(current.kind, 'path'); assert.equal(current.letterform.presetId, preset.id);
        const commands = hash(current.glyphs.map(glyph => glyph.commands));
        assert.notEqual(commands, originalCommands);
        assert.deepEqual(current.style, original.style);
        for (const glyph of current.glyphs) for (const command of glyph.commands) for (const [key, value] of Object.entries(command)) if (key !== 'type') assert.ok(Number.isFinite(value));
        const svg = await page.getByTestId('artboard').locator(`.movable-art[data-layer-id="${id}"]`).innerHTML();
        assert.doesNotMatch(svg, /NaN|Infinity/);
        variants.push({ id: preset.id, commands });
        await page.getByRole('button', { name: '恢复原始字形', exact: true }).click();
        const restored = (await project(page)).layers.find(layer => layer.id === id);
        assert.deepEqual(restored.glyphs, original.glyphs); assert.equal(restored.kind, original.kind);
        assert.equal(restored.letterform, undefined);
        check(`${preset.name}真实修改路径并完整恢复原字形`, true);
      }
    }
    check('十种字形轮廓互不相同', new Set(variants.map(item => item.commands)).size === 10);
    await writeFile(artifact('letterforms.json'), JSON.stringify(variants, null, 2));
    await capture(page, 'letterforms.png');
  });

  await caseRun('exports', async page => {
    const initial = await project(page), selected = initial.layers.at(-1);
    await rail(page, '图层');
    const hiddenId = initial.layers[0].id;
    await page.locator(`[data-layer-drop-id="${hiddenId}"]`).getByRole('button', { name: '隐藏图层', exact: true }).click();
    const current = await project(page);
    assert.equal(current.layers.find(layer => layer.id === hiddenId).visible, false);
    await writeFile(artifact('export-project.json'), JSON.stringify(current, null, 2));
    async function exportUi(mode, format, name) {
      await page.getByRole('button', { name: '导出标题', exact: true }).click();
      await page.getByLabel('导出范围', { exact: true }).selectOption('canvas');
      await page.getByLabel('输出精度', { exact: true }).selectOption('1');
      await page.getByLabel('PNG导出方式', { exact: true }).selectOption(mode);
      const file = await download(page, page.getByTestId(format === 'psd' ? 'download-psd' : 'download-png'), name);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      return file;
    }
    const composite = await exportUi('composite', 'png', 'ui-composite.png');
    const compositeStats = await alpha(composite.bytes);
    assert.deepEqual([compositeStats.width, compositeStats.height], [current.width, current.height]);
    check('整张PNG UI下载原尺寸且有透明与实绘像素', compositeStats.clear > 1000 && compositeStats.painted > 1000 && compositeStats.partial > 0, compositeStats);
    const single = await exportUi('selected', 'png', 'ui-selected.png');
    const singleStats = await alpha(single.bytes);
    assert.deepEqual([singleStats.width, singleStats.height], [current.width, current.height]);
    assert.ok(single.suggested.includes(selected.name));
    check('所选图层PNG UI下载仅含所选内容', singleStats.clear > compositeStats.clear && singleStats.painted > 1000 && singleStats.hash !== compositeStats.hash, singleStats);
    const zip = await exportUi('layers', 'png', 'ui-layers.zip');
    const files = unzipSync(zip.bytes), names = Object.keys(files), visible = current.layers.filter(layer => layer.visible);
    assert.equal(names.length, visible.length); assert.equal(new Set(names).size, names.length);
    const layerStats = [];
    for (let index = 0; index < visible.length; index++) {
      const name = names[index]; assert.ok(name.startsWith(`${String(index + 1).padStart(3, '0')}-`));
      assert.ok(name.includes(visible[index].name)); assert.ok(name.endsWith('.png'));
      const bytes = Buffer.from(files[name]), stats = await alpha(bytes);
      assert.deepEqual([stats.width, stats.height], [current.width, current.height]);
      assert.ok(stats.clear > 1000 && stats.painted > 10 && stats.partial > 0, name);
      if (visible[index].id === selected.id) assert.equal(stats.hash, singleStats.hash);
      await writeFile(artifact(`zip-${index + 1}.png`), bytes);
      layerStats.push({ name, ...stats });
    }
    check('逐层ZIP下载数量、层名、共同坐标及透明通道准确', true, { layers: names.length });
    const psd = await exportUi('composite', 'psd', 'ui-layers.psd');
    assert.equal(psd.bytes.subarray(0, 4).toString(), '8BPS');
    const parsed = readPsd(psd.bytes, { useImageData: true, skipThumbnail: true });
    assert.deepEqual([parsed.width, parsed.height], [current.width, current.height]);
    // PSD records and ag-psd children are bottom-to-top, like project.layers.
    // Photoshop presents the same stack top-to-bottom in its layer panel.
    const expectedLayers = current.layers;
    assert.equal(parsed.children.length, expectedLayers.length);
    for (let index = 0; index < expectedLayers.length; index++) {
      const got = parsed.children[index], expected = expectedLayers[index];
      assert.equal(got.name, expected.name); assert.equal(Boolean(got.hidden), !expected.visible);
      assert.ok(got.imageData && got.imageData.data.length === got.imageData.width * got.imageData.height * 4);
      assert.ok(got.right > got.left && got.bottom > got.top);
      let painted = 0, clear = 0;
      for (let i = 3; i < got.imageData.data.length; i += 4) got.imageData.data[i] ? painted++ : clear++;
      assert.ok(painted > 10 && clear > 10, expected.name);
    }
    check('PSD UI下载保留工程底到顶顺序、全部独立层、显隐与RGBA', true, { layers: parsed.children.length, bottomToTop: parsed.children.map(layer => layer.name), photoshopTopToBottom: current.layers.map(layer => layer.name).reverse() });
    await writeFile(artifact('export-summary.json'), JSON.stringify({ composite: compositeStats, selected: singleStats, zip: layerStats, psd: { width: parsed.width, height: parsed.height, layers: parsed.children.map(layer => ({ name: layer.name, hidden: layer.hidden, left: layer.left, top: layer.top, right: layer.right, bottom: layer.bottom })) } }, null, 2));
    await capture(page, 'exports.png');
  });

  await caseRun('merge', async page => {
    const initial = await project(page);
    await rail(page, '图层');
    const ids = [initial.layers[0].id, initial.layers[2].id, initial.layers.at(-1).id];
    check('未多选时合并按钮禁用', await page.getByTestId('merge-layers').isDisabled());
    for (const id of ids) await page.locator(`[data-layer-drop-id="${id}"] input[type="checkbox"]`).check();
    assert.equal(await page.locator('.layer-checkbox:checked').count(), ids.length);
    await page.getByTestId('merge-layers').click();
    const merged = await project(page), created = merged.layers.filter(layer => !initial.layers.some(old => old.id === layer.id));
    assert.equal(merged.layers.length, initial.layers.length - ids.length + 1); assert.equal(created.length, 1);
    assert.equal(created[0].kind, 'image'); assert.match(created[0].imageSrc, /^data:image\/png;base64,/);
    assert.deepEqual(merged.layers.filter(layer => layer.id !== created[0].id), initial.layers.filter(layer => !ids.includes(layer.id)));
    const highest = Math.max(...ids.map(id => initial.layers.findIndex(layer => layer.id === id)));
    assert.equal(merged.layers.findIndex(layer => layer.id === created[0].id), initial.layers.slice(0, highest).filter(layer => !ids.includes(layer.id)).length);
    const image = await alpha(Buffer.from(created[0].imageSrc.split(',')[1], 'base64'));
    check('多选合并生成有透明像素的图片并保留最高选中层位置', image.clear > 100 && image.painted > 100, image);
    await undo(page); assert.deepEqual(await project(page), initial);
    check('合并一次撤销恢复全部原始图层和轮廓', true);
    await capture(page, 'merge.png');
  });

  await caseRun('mobile', async page => {
    check('移动端初始画布不横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(page, 'mobile-canvas.png');
    await page.getByRole('button', { name: '风格与素材', exact: true }).click();
    assert.ok(await page.getByTestId('styles-catalog').isVisible());
    check('移动端显示完整风格总数', (await page.getByTestId('catalog-total').innerText()).startsWith('200'));
    await page.locator('.mobile-library-nav').getByRole('button', { name: '装饰', exact: true }).click();
    assert.ok(await page.getByTestId('stickers-catalog').isVisible());
    check('移动端显示完整装饰总数', (await page.getByTestId('catalog-total').innerText()).startsWith('400'));
    await page.getByLabel('搜索装饰', { exact: true }).fill('月牙');
    assert.ok(await page.locator('.sticker-card').count() > 0);
    await capture(page, 'mobile-library.png');
    await page.locator('.library-panel').getByRole('button', { name: '回到画布', exact: true }).click();
    await page.getByRole('button', { name: '编辑属性', exact: true }).click();
    assert.ok(await page.locator('.properties-panel').isVisible());
    await page.getByLabel('字体来源', { exact: true }).selectOption('bundled');
    await page.getByLabel('字体语言', { exact: true }).selectOption('zh-Hant');
    assert.match(await page.locator('.font-caption').innerText(), /9 款匹配/);
    check('移动端可操作内置繁体字库筛选', true);
    check('移动端属性面板不横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(page, 'mobile-properties.png');
    await page.locator('.properties-panel').getByRole('button', { name: '回到画布', exact: true }).click();
    await page.getByRole('button', { name: '导出标题', exact: true }).click();
    assert.ok(await page.getByRole('dialog').isVisible());
    await page.getByLabel('PNG导出方式', { exact: true }).selectOption('layers');
    check('移动端导出方式可选择逐层PNG', await page.getByTestId('download-png').isEnabled());
    check('移动端导出窗口不横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(page, 'mobile-export.png');
  }, { width: 390, height: 844 });
} finally {
  if (browser) await browser.close();
  if (server) { await server.fontService.close(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(path.dirname(dataDir), output);
  assert.ok(path.basename(dataDir).startsWith('.data-'));
  await rm(dataDir, { recursive: true, force: true });
  report.completed = new Date().toISOString();
  report.passed = report.cases.filter(item => item.status === 'passed').length;
  report.failed = report.cases.filter(item => item.status === 'failed').length;
  report.checkCount = report.checks.length;
  report.partial = Boolean(only);
  await writeFile(artifact(only ? `results-${only.join('-')}.json` : 'results.json'), JSON.stringify(report, null, 2));
  console.log(`UPGRADE RESULT: cases=${report.cases.length}; passed=${report.passed}; failed=${report.failed}; checks=${report.checkCount}; ${only ? 'partial' : 'full'}`);
}
if (report.failed) process.exitCode = 1;
