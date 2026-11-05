import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { start } from '../server/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv.includes('--baseline');
const out = path.join(root, 'verification', 'search-refresh', baseline ? 'before' : 'after');
await mkdir(out, { recursive: true });
const dataDir = await mkdtemp(path.join(out, '.data-'));
const errors = [], checks = [], snapshots = [];
let server, browser;
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
async function idle(page) {
  await page.waitForFunction(() => {
    const marker = document.querySelector('[data-testid="state-marker"]');
    return marker?.dataset.loading === 'false' && marker.dataset.dirty === 'false' && marker.dataset.busy === '';
  });
}
async function save(page) {
  const event = page.waitForEvent('download');
  await page.locator('.header-actions').getByRole('button', { name: '保存工程', exact: true }).click();
  return JSON.parse(await readFile(await (await event).path(), 'utf8'));
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  snapshots.push(`${name}.png`);
}
try {
  server = await start({ port: 0, dataDir, includeSystemFonts: false, scanRegistry: false, fontDirectories: [] });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await idle(page);
    if (width === 390) await page.getByRole('button', { name: '编辑属性', exact: true }).click();
    const input = page.getByLabel('搜索字体', { exact: true });
    await input.scrollIntoViewIfNeeded();
    await snap(page, `initial-${width}`);
    await input.hover(); await snap(page, `hover-${width}`);
    await input.click(); await snap(page, `focus-${width}`);
    const initial = width === 1440 ? await save(page) : null;
    await input.fill('ddad'); await snap(page, `empty-${width}`);
    if (baseline) {
      const observations = await input.evaluate(node => ({ inputOutline: getComputedStyle(node).outlineStyle, parentOutline: getComputedStyle(node.parentElement).outlineStyle, text: node.closest('.section-content').innerText }));
      console.log(`BASELINE ${width} ${JSON.stringify(observations)}`);
      await context.close(); continue;
    }
    const state = page.getByTestId('font-empty');
    check(`Empty search clearly explained at ${width}`, await state.isVisible() && (await state.innerText()).includes('没有找到匹配字体'));
    check(`Empty results disable font selection at ${width}`, await page.getByLabel('选择字体', { exact: true }).isDisabled());
    const focus = await input.evaluate(node => ({ inner: getComputedStyle(node).outlineStyle, outer: getComputedStyle(node.parentElement).outlineStyle }));
    check(`One enclosing focus ring at ${width}`, focus.inner === 'none' && focus.outer !== 'none');
    await page.getByRole('button', { name: '清除字体搜索', exact: true }).click();
    check(`Clear restores focus at ${width}`, await input.inputValue() === '' && await input.evaluate(node => document.activeElement === node));
    check(`Clear restores selectable fonts at ${width}`, await page.getByLabel('选择字体', { exact: true }).isEnabled());
    await input.fill('ＮＯＴＯ   ＳＡＮＳ　ＳＣ');
    check(`Normalized multilingual spaced query matches at ${width}`, !(await page.getByLabel('选择字体', { exact: true }).isDisabled()));
    const optionText = await page.getByLabel('选择字体').locator('optgroup[label="匹配字体"] option').allTextContents();
    check(`Search terms match across font metadata at ${width}`, optionText.length > 0 && optionText.every(text => /noto sans sc/i.test(text)));
    await input.press('Escape');
    check(`Escape clears without losing input focus at ${width}`, await input.inputValue() === '' && await input.evaluate(node => document.activeElement === node));
    await page.getByLabel('字体来源', { exact: true }).selectOption('local');
    check(`Source filter empty state explains preserved font at ${width}`, await state.isVisible() && (await page.getByTestId('current-font').innerText()).includes('当前使用'));
    await state.getByRole('button', { name: '重置筛选', exact: true }).click();
    check(`Reset restores every filter at ${width}`, await page.getByLabel('字体来源').inputValue() === 'all' && await page.getByLabel('字体语言').inputValue() === 'all' && await input.inputValue() === '');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(`No horizontal overflow at ${width}`, !overflow);
    await input.fill('  huninn  '); await snap(page, `matched-${width}`);
    if (width === 1440) {
      const unchanged = await save(page);
      assert.deepEqual(unchanged, initial);
      check('Searching and resetting never changes selected font or project', true);
      const catalog = await (await page.request.get(`${origin}/api/fonts`)).json();
      const chosen = catalog.fonts.find(font => font.family === 'Huninn');
      await page.getByLabel('选择字体', { exact: true }).selectOption(chosen.id);
      await idle(page);
      check('Selecting a real search result updates project font', (await save(page)).layers.at(-1).fontId === chosen.id);
      for (const name of ['风格', '装饰']) {
        await page.locator('.rail').getByRole('button', { name, exact: true }).click();
        const search = page.getByLabel(`搜索${name}`, { exact: true });
        await search.fill('test-no-matches');
        const styling = await search.evaluate(node => ({ inner: getComputedStyle(node).outlineStyle, outer: getComputedStyle(node.parentElement).outlineStyle }));
        check(`${name} shares enclosing search focus ring`, styling.inner === 'none' && styling.outer !== 'none');
        await page.getByRole('button', { name: '清除搜索', exact: true }).click();
        check(`${name} clear restores search focus`, await search.inputValue() === '' && await search.evaluate(node => document.activeElement === node));
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ baseline, checks, errors, snapshots }, null, 2));
  console.log(`SEARCH RESULT: ${checks.length} checks passed; baseline=${baseline}; errors=${errors.length}`);
} finally {
  await browser?.close();
  if (server) { await server.fontService.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dataDir, { recursive: true, force: true });
}
