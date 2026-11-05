import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import * as fontkit from 'fontkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets/fonts');
const reports = path.join(root, 'verification/bundled-fonts');
const manifestPath = path.join(assets, 'manifest.json');
const commit = 'bbda7253fc363238b05d97515ca71f8ae49c4fa9';
const repository = 'https://github.com/google/fonts';
const rawRoot = `https://raw.githubusercontent.com/google/fonts/${commit}`;
const apacheFamilies = new Set(['luckiestguy', 'chewy', 'permanentmarker', 'satisfy', 'ultra']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samples = {
  'zh-Hans': '中文标题封面设计快乐学习书法艺术龙马风云字体春夏秋冬你好世界爱国梦想',
  'zh-Hant': '中文標題封面設計快樂學習書法藝術龍馬風雲字體春夏秋冬你好世界愛國夢想臺灣繁體',
  en: Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)).join(''),
};
const selections = [
  ['notosanssc', '黑体'], ['notoserifsc', '宋体'], ['notosanstc', '黑體'], ['notoseriftc', '宋體'],
  ['lxgwwenkaitc', '楷體/手寫'],
  ['zcoolkuaile', '圆体/卡通'], ['zcoolxiaowei', '宋体/展示'], ['zcoolqingkehuangyou', '窄黑/展示'],
  ['mashanzheng', '毛笔/书法'], ['longcang', '草书'], ['liujianmaocao', '草书'], ['zhimangxing', '行草'],
  ['iansui', '手寫'], ['huninn', '圓體'], ['wdxllubrifonttc', '窄黑/展示'],
  ['anton', 'condensed/sans'], ['bebasneue', 'condensed/poster'], ['oswald', 'condensed/sans'], ['barlowcondensed', 'condensed/sans'],
  ['archivoblack', 'black/sans'], ['bowlbyonesc', 'black/display'], ['bungee', 'poster'], ['bungeeshade', 'retro/shadow'],
  ['blackopsone', 'stencil'], ['russoone', 'square/sans'], ['righteous', 'retro'], ['fredoka', 'rounded'],
  ['baloo2', 'rounded'], ['lilitaone', 'cartoon'], ['luckiestguy', 'cartoon'], ['chewy', 'cartoon'],
  ['boogaloo', 'cartoon'], ['bangers', 'comic'], ['permanentmarker', 'marker'], ['caveat', 'handwriting'],
  ['kalam', 'handwriting'], ['patrickhand', 'handwriting'], ['amaticsc', 'handwriting/condensed'], ['pacifico', 'script'],
  ['lobster', 'script'], ['dancingscript', 'script'], ['satisfy', 'script'], ['sacramento', 'script'],
  ['playfairdisplay', 'serif'], ['cormorantgaramond', 'serif'], ['cinzel', 'roman/serif'], ['dmserifdisplay', 'serif/display'],
  ['abrilfatface', 'serif/display'], ['alfaslabone', 'slab'], ['ultra', 'slab/retro'], ['cutivemono', 'typewriter'],
  ['rubikmonoone', 'geometric'], ['monoton', 'retro/inline'], ['audiowide', 'science-fiction'], ['pressstart2p', 'pixel'],
];

async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
async function json(file, data) { await atomic(file, `${JSON.stringify(data, null, 2)}\n`); }
async function existing(file) {
  try { return await readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'cover-type-studio-font-preparation' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function pool(items, fn, width = 4) {
  const results = Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (index < items.length) {
      const position = index++;
      results[position] = await fn(items[position]);
    }
  }));
  return results;
}
function field(text, name) { return text.match(new RegExp(`^\\s*${name}: "([^"\\n]*)"`, 'm'))?.[1]; }
function assertLicense(bytes, license, label) {
  const text = bytes.toString('utf8');
  const complete = license === 'OFL-1.1'
    ? /SIL OPEN FONT LICENSE Version 1\.1/.test(text) && /PERMISSION & CONDITIONS/.test(text) && /TERMINATION/.test(text) && /DISCLAIMER/.test(text)
    : license === 'Apache-2.0' && /Apache License/.test(text) && /Version 2\.0, January 2004/.test(text) && /4\. Redistribution/.test(text) && /END OF TERMS AND CONDITIONS/.test(text) && /APPENDIX:/.test(text);
  if (!complete) throw new Error(`${label}: incomplete ${license} license`);
}
async function discover([slug, style]) {
  const directory = apacheFamilies.has(slug) ? 'apache' : 'ofl';
  const licenseName = directory === 'apache' ? 'LICENSE.txt' : 'OFL.txt';
  const licenseId = directory === 'apache' ? 'Apache-2.0' : 'OFL-1.1';
  const base = `${rawRoot}/${directory}/${slug}`;
  const [metadata, license] = await Promise.all([fetchBytes(`${base}/METADATA.pb`), fetchBytes(`${base}/${licenseName}`)]);
  const text = metadata.toString('utf8');
  if (field(text, 'license') !== (directory === 'apache' ? 'APACHE2' : 'OFL')) throw new Error(`${slug}: license metadata does not match source`);
  assertLicense(license, licenseId, slug);
  const fonts = [...text.matchAll(/^fonts \{([\s\S]*?)^\}/gm)].map(match => ({
    file: field(match[1], 'filename'), style: field(match[1], 'style'), weight: Number(match[1].match(/weight: (\d+)/)?.[1]),
  }));
  const selected = fonts.filter(font => font.style === 'normal').sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0];
  if (!selected?.file || !/\.(ttf|otf|woff2)$/i.test(selected.file) || path.basename(selected.file) !== selected.file) throw new Error(`${slug}: missing complete normal font file`);
  const source = text.match(/^source \{([\s\S]*)/m)?.[1] || '';
  const record = {
    identity: `google-fonts:${slug}:normal`, slug, family: field(text, 'name'), style,
    file: `${slug}/${selected.file}`, sourceUrl: `${repository}/blob/${commit}/${directory}/${slug}/${encodeURIComponent(selected.file)}`,
    downloadUrl: `${base}/${encodeURIComponent(selected.file)}`,
    license: licenseId, licenseFile: `${slug}/${licenseName}`, licenseUrl: `${base}/${licenseName}`, licenseSha256: hash(license),
    metadataFile: `${slug}/METADATA.pb`, metadataUrl: `${base}/METADATA.pb`, metadataSha256: hash(metadata),
    upstreamRepository: field(source, 'repository_url') || repository,
    ...(field(source, 'commit') ? { upstreamCommit: field(source, 'commit') } : {}),
  };
  console.log(`SOURCE ${record.family}: ${selected.file}`);
  return { record, metadata, license };
}
function inspectFont(bytes) {
  const face = fontkit.create(bytes);
  if (face.fonts) throw new Error('Expected one complete face per family, not a collection');
  const probes = Object.fromEntries(Object.entries(samples).map(([language, text]) => {
    const points = [...new Set([...text])];
    const missing = points.filter(char => !face.hasGlyphForCodePoint(char.codePointAt(0)));
    return [language, { codepoints: points.length, covered: points.length - missing.length, missing }];
  }));
  const codepoints = face.characterSet;
  return {
    fontFamily: face.familyName, subfamily: face.subfamilyName, postscriptName: face.postscriptName,
    languages: Object.keys(samples).filter(language => probes[language].missing.length === 0),
    glyphCount: face.numGlyphs, codepointCount: codepoints.length,
    hanCodepointCount: codepoints.filter(cp => (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x20000 && cp <= 0x323af)).length,
    probes,
  };
}
function checkTotals(fonts) {
  const unique = new Set(fonts.map(font => font.family));
  for (const font of fonts) if (!font.languages.length) throw new Error(`${font.family}: no complete tested language sample`);
  const count = language => fonts.filter(font => font.languages.includes(language)).length;
  const chinese = fonts.filter(font => font.languages.some(language => language.startsWith('zh-'))).length;
  const latinOnly = fonts.filter(font => font.languages.includes('en') && !font.languages.some(language => language.startsWith('zh-'))).length;
  const size = fonts.reduce((sum, font) => sum + font.size, 0);
  if (unique.size !== fonts.length || fonts.length < 50 || chinese < 12 || count('zh-Hans') < 5 || count('zh-Hant') < 5 || latinOnly < 30) throw new Error(`Insufficient distinct families/coverage: ${JSON.stringify({ families: unique.size, chinese, latinOnly, hans: count('zh-Hans'), hant: count('zh-Hant') })}`);
  if (size > 200 * 1024 * 1024) throw new Error(`Font budget exceeded: ${size} bytes`);
  return { families: unique.size, chineseFamilies: chinese, englishOnlyFamilies: latinOnly, languageCounts: Object.fromEntries(Object.keys(samples).map(language => [language, count(language)])), fontBytes: size, fontMiB: Number((size / 1024 / 1024).toFixed(2)) };
}
async function report(manifest, inspected) {
  const summary = checkTotals(manifest.fonts);
  await json(path.join(reports, 'coverage-license-report.json'), {
    schemaVersion: 1, verifiedAt: new Date().toISOString(), command: 'node scripts/prepare-fonts.mjs --verify',
    repository, commit, summary, coverageSamples: samples,
    coverageMeaning: 'Language tags mean every codepoint in the listed representative sample is present. They do not claim complete coverage of every character in that language. All original complete upstream font files are preserved without subsetting or modification.',
    licenseConditions: 'SIL OFL 1.1 and Apache 2.0 permit commercial use, embedding, bundling and redistribution with software. All files remain unmodified. Keep each original copyright, attribution metadata and full license. OFL fonts must retain their license and may not be sold by themselves; reserved font names apply to modified versions. No separate NOTICE files are present in the selected Apache upstream directories at the pinned commit (see source-tree.json). Generated artwork is not subject to these font licenses.',
    fonts: inspected,
  });
  console.log(JSON.stringify({ status: 'verified', ...summary }));
}
async function verify(manifest) {
  if (manifest.schemaVersion !== 1 || manifest.source.commit !== commit) throw new Error('Unexpected font manifest schema/source');
  const inspected = [];
  for (const record of manifest.fonts) {
    const [bytes, license, metadata] = await Promise.all([readFile(path.join(assets, record.file)), readFile(path.join(assets, record.licenseFile)), readFile(path.join(assets, record.metadataFile))]);
    if (hash(bytes) !== record.sha256 || bytes.length !== record.size) throw new Error(`${record.family}: font hash/size mismatch`);
    if (hash(license) !== record.licenseSha256 || hash(metadata) !== record.metadataSha256) throw new Error(`${record.family}: attribution hash mismatch`);
    assertLicense(license, record.license, record.family);
    const info = inspectFont(bytes);
    if (JSON.stringify(info.languages) !== JSON.stringify(record.languages) || info.postscriptName !== record.postscriptName || info.fontFamily !== record.fontFamily) throw new Error(`${record.family}: measured metadata mismatch`);
    inspected.push({ ...record, ...info, fontHashVerified: true, licenseHashVerified: true, metadataHashVerified: true });
  }
  await report(manifest, inspected);
}
async function prepare() {
  const lockedBytes = await existing(manifestPath);
  const locked = lockedBytes ? JSON.parse(lockedBytes.toString('utf8')) : undefined;
  const refreshManifest = process.argv.includes('--refresh-manifest');
  if (refreshManifest && process.argv.includes('--verify')) throw new Error('Use --verify or --refresh-manifest separately');
  if (locked && !refreshManifest) {
    if (!process.argv.includes('--verify')) {
      await pool(locked.fonts, async record => {
        for (const [relative, url, expected] of [[record.file, record.downloadUrl, record.sha256], [record.licenseFile, record.licenseUrl, record.licenseSha256], [record.metadataFile, record.metadataUrl, record.metadataSha256]]) {
          let bytes = await existing(path.join(assets, relative));
          if (!bytes || hash(bytes) !== expected) {
            bytes = await fetchBytes(url);
            if (hash(bytes) !== expected) throw new Error(`${record.family}: locked download hash mismatch: ${url}`);
            await atomic(path.join(assets, relative), bytes);
          }
        }
      });
    }
    await verify(locked);
    return;
  }
  if (process.argv.includes('--verify')) throw new Error('Font manifest missing; run node scripts/prepare-fonts.mjs first');
  const sources = await pool(selections, discover);
  await json(path.join(reports, 'upstream-discovery.json'), { repository, commit, fonts: sources.map(source => source.record) });
  if (process.argv.includes('--discover')) return;
  const fonts = await pool(sources, async ({ record, metadata, license }) => {
    const file = path.join(assets, record.file);
    const previous = locked?.fonts.find(font => font.identity === record.identity && font.downloadUrl === record.downloadUrl);
    let bytes = previous ? await existing(file) : undefined;
    if (!bytes || hash(bytes) !== previous.sha256) bytes = await fetchBytes(record.downloadUrl);
    if (previous && hash(bytes) !== previous.sha256) throw new Error(`${record.family}: locked source changed`);
    const info = inspectFont(bytes);
    await Promise.all([atomic(file, bytes), atomic(path.join(assets, record.metadataFile), metadata), atomic(path.join(assets, record.licenseFile), license)]);
    console.log(`FONT ${record.family}: ${bytes.length} bytes; ${info.languages.join(', ')}`);
    const { probes, ...metadataInfo } = info;
    return { ...record, ...metadataInfo, faceIndex: 0, sha256: hash(bytes), size: bytes.length };
  }, 3);
  checkTotals(fonts);
  const manifest = { schemaVersion: 1, source: { repository, commit }, coverageSamples: samples, fonts };
  await json(manifestPath, manifest);
  await verify(manifest);
}
await prepare();
