import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { start as startApi } from '../server/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), out = path.join(root, 'verification/glyph-transform-1.5');
const near = (a, b, epsilon = 0.02) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

export async function verifyGlyphBrowser() {
  await mkdir(out, { recursive: true });
  const report = { checks: [], errors: [] };
  const check = (name, value) => { assert.ok(value, name); report.checks.push(name); console.log(`PASS ${name}`); };
  const dist = path.join(out, 'dist');
  await build({ root, configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic' }, build: { outDir: dist, emptyOutDir: true, rollupOptions: { preserveEntrySignatures: 'strict', input: { app: path.join(root, 'index.html'), checks: path.join(root, 'scripts/verify-glyph-browser-checks.mjs') }, output: { entryFileNames: 'assets/[name].js' } } } });
  await writeFile(path.join(dist, 'glyph-check.html'), '<!doctype html><html><body></body></html>');
  const api = await startApi({ port: 0, staticDir: dist, dataDir: path.join(out, 'api-data'), includeSystemFonts: false, scanRegistry: false, includeBundledFonts: true });
  const appBase = `http://127.0.0.1:${api.address().port}`;
  let browser;
  try {
    const moduleUrl = appBase + '/assets/checks.js';
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(appBase + '/glyph-check.html');
    await page.evaluate(async url => { window.glyphChecks = await import(url); }, moduleUrl);

    const fixture = await page.evaluate(() => window.glyphChecks.parseProject(JSON.stringify(window.glyphChecks.makeFixture())));
    await writeFile(path.join(out, 'interactive-fixture.zizao.json'), JSON.stringify(fixture, null, 2));
    const idle = await page.evaluate(p => window.glyphChecks.idleFrameCount(p), fixture);
    check('no transform box is drawn before a glyph is double-clicked', idle.frames === 0 && idle.handles === 0 && idle.dashes === 3);
    const frame = await page.evaluate(p => window.glyphChecks.frameSnapshot(p), fixture);
    check('four corner handles plus a rotation knob are drawn for the selected glyph', frame.handles.length === 4 && frame.frames === 1 && frame.knob.focusable && frame.handles.every(h => h.focusable));
    frame.handles.forEach((handle, index) => {
      near(handle.local.x, frame.corners[index].x, 0.001);
      near(handle.local.y, frame.corners[index].y, 0.001);
      near(handle.cssX, handle.screen.x, 1.5);
      near(handle.cssY, handle.screen.y, 1.5);
    });
    check('every handle sits exactly on its glyph corner in data space and on screen', true);
    check('rotation knob floats above the box, centred on its top edge', frame.knob.cy < frame.corners[0].y - 20 && Math.abs(frame.knob.cx - (frame.corners[0].x + frame.corners[1].x) / 2) < 1);

    await context.addInitScript(({ origin, fixture }) => { if (location.origin === origin) localStorage.setItem('cover-type-studio-v1', JSON.stringify(fixture)); }, { origin: appBase, fixture });
    await page.goto(appBase);
    await page.waitForFunction(() => document.querySelector('[data-testid="state-marker"]')?.getAttribute('data-loading') === 'false', {}, { timeout: 120000 });
    await page.evaluate(async url => { window.glyphChecks = await import(url); }, moduleUrl);
    const settle = async () => { await page.waitForTimeout(650); await page.waitForFunction(() => document.querySelector('[data-testid="state-marker"]')?.getAttribute('data-busy') === ''); };
    const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('cover-type-studio-v1')));
    const history = () => page.getByTestId('state-marker').evaluate(marker => { const key = Object.keys(marker).find(k => k.startsWith('__reactFiber')); for (let fiber = marker[key]; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook && typeof hook === 'object'; hook = hook.next) { const value = hook.memoizedState?.current; if (value && Array.isArray(value.past) && Array.isArray(value.future)) return value.past.length; } throw new Error('Live history ref not found'); });
    const savePixels = async (name, p) => {
      const png = await page.evaluate(async value => { const m = window.glyphChecks, rgba = await m.pixels(m.layerDocument(value)), canvas = document.createElement('canvas'); canvas.width = rgba.width; canvas.height = rgba.height; canvas.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0); return canvas.toDataURL('image/png').split(',')[1]; }, p);
      await writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
    };
    const drag = async (locator, dx, dy, shift = false) => {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      assert.ok(b, 'handle must be laid out');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) await page.mouse.move(b.x + b.width / 2 + dx * i / 8, b.y + b.height / 2 + dy * i / 8);
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      await settle();
    };

    await settle();
    assert.deepEqual(await project(), fixture);
    check('application loaded the exact persisted fixture', true);
    check('selecting the text layer draws one dashed box per glyph and no transform box', await page.locator('.glyph-target').count() === 3 && await page.locator('.glyph-frame').count() === 0);
    await page.locator('[data-glyph-index="0"]').first().dblclick();
    await settle();
    check('double-clicking the glyph opens its transform box', await page.locator('.glyph-frame').count() === 1 && await page.getByTestId('glyph-scale-handle-2').isVisible() && await page.getByTestId('glyph-rotate-handle').isVisible());
    await page.screenshot({ path: path.join(out, 'glyph-box.png') });

    const before = await project();
    await page.evaluate(async p => { const m = window.glyphChecks; window.glyphPixelsBefore = await m.pixels(m.layerDocument(p)); }, before);
    const beforeHistory = await history();
    await drag(page.getByTestId('glyph-scale-handle-2'), 90, 60);
    const scaled = await project(), glyph = scaled.layers[0].glyphs[0];
    check(`corner drag scaled only this glyph to ${glyph.scaleX.toFixed(3)} x ${glyph.scaleY.toFixed(3)}`, glyph.scaleX > 1.2 && glyph.scaleY > 1.05);
    check('the neighbouring glyphs were not touched', JSON.stringify(scaled.layers[0].glyphs.slice(1)) === JSON.stringify(before.layers[0].glyphs.slice(1)));
    report.scalePixels = await page.evaluate(async p => { const m = window.glyphChecks; return m.difference(window.glyphPixelsBefore, await m.pixels(m.layerDocument(p))); }, scaled);
    check(`scaling changes real rendered pixels (maxRGB=${report.scalePixels.maxPremultiplied.toFixed(2)}, changed=${report.scalePixels.differentPixels})`, report.scalePixels.differentPixels > 0 && report.scalePixels.maxPremultiplied > 0);
    await savePixels('scale-before', before);
    await savePixels('scale-after', scaled);
    check('one drag gesture produced exactly one undo entry', (await history()) === beforeHistory + 1);
    await page.keyboard.press('Control+z');
    await settle();
    assert.deepEqual(await project(), before);
    check('a single undo restores the glyph byte for byte', true);

    const beforeSpin = await project();
    await page.evaluate(async p => { const m = window.glyphChecks; window.glyphPixelsBefore = await m.pixels(m.layerDocument(p)); }, beforeSpin);
    await drag(page.getByTestId('glyph-rotate-handle'), 120, 30, true);
    const spun = await project(), rotation = spun.layers[0].glyphs[0].rotation || 0;
    check(`rotation knob turned the glyph to ${rotation} degrees`, rotation !== 0 && Math.abs(rotation % 15) < 1e-6);
    check('rotating kept the neighbouring glyphs intact', JSON.stringify(spun.layers[0].glyphs.slice(1)) === JSON.stringify(beforeSpin.layers[0].glyphs.slice(1)));
    report.rotatePixels = await page.evaluate(async p => { const m = window.glyphChecks; return m.difference(window.glyphPixelsBefore, await m.pixels(m.layerDocument(p))); }, spun);
    check(`rotation changes real rendered pixels (maxRGB=${report.rotatePixels.maxPremultiplied.toFixed(2)}, changed=${report.rotatePixels.differentPixels})`, report.rotatePixels.differentPixels > 0 && report.rotatePixels.maxPremultiplied > 0);
    await savePixels('rotate-after', spun);
    await page.screenshot({ path: path.join(out, 'glyph-rotated.png') });

    await page.getByTestId('glyph-rotate-handle').focus();
    const keyBefore = await project();
    await page.keyboard.press('ArrowRight');
    await settle();
    near(((await project()).layers[0].glyphs[0].rotation || 0) - (keyBefore.layers[0].glyphs[0].rotation || 0), 1, 0.001);
    check('arrow keys on the focused rotate knob turn the glyph by one degree', true);

    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    const mobile = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, artboard: document.querySelector('[data-testid="artboard"]')?.getBoundingClientRect(), handle: document.querySelector('[data-testid="glyph-scale-handle-0"]')?.getBoundingClientRect() }));
    check(`390px layout keeps the page and the transform box on screen (scrollWidth=${mobile.scroll})`, mobile.scroll <= 390 && mobile.handle.x >= 0 && mobile.handle.right <= 390);
    await page.screenshot({ path: path.join(out, 'glyph-mobile.png') });

    check('no page errors during the run', report.errors.length === 0);
    await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
    console.log(`GLYPH RESULT: ${report.checks.length} checks passed; artifacts ${out}`);
    return report;
  } finally {
    await browser?.close();
    await api.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyGlyphBrowser().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
}
