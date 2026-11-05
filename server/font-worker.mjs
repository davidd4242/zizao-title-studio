import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile, mkdir, readdir, stat, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { ApiError, outlineFont, validateOutline } from './outline.mjs';

const exec = promisify(execFile);
const extensions = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2']);
const maxFontBytes = 128 * 1024 * 1024;
const metadataCacheVersion = 2;
const keyFor = value => process.platform === 'win32' ? value.toLowerCase() : value;
const hash = value => createHash('sha256').update(value).digest('hex');
const options = workerData;
const dataDir = path.resolve(options.dataDir);
const importedDir = path.join(dataDir, 'imported');
const configPath = path.join(dataDir, 'directories.json');
const cachePath = path.join(dataDir, 'font-cache.json');
const bundledDir = path.resolve(options.bundledFontsDir || fileURLToPath(new URL('../assets/fonts', import.meta.url)));
const loaded = new Map();
let loadedBytes = 0;
let config = { directories: [] };
let cache = {};
let records = new Map();
let catalog;
const statistics = { filesParsed: 0, metadataCacheHits: 0, outlineCacheHits: 0 };

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
function localized(records, name, fallback) {
  const names = records?.[name] || {};
  for (const language of ['zh', 'zh-CN', 'zh-Hans', 'zh-TW', ...Object.keys(names).filter(key => key.startsWith('zh')), 'en']) {
    if (typeof names[language] === 'string' && names[language].trim()) return names[language].trim();
  }
  return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : '';
}
function metadata(face, file, index, bundled) {
  const names = face.name?.records;
  const family = bundled?.family || localized(names, 'preferredFamily', '') || localized(names, 'fontFamily', face.familyName) || path.basename(file);
  const subfamily = localized(names, 'preferredSubfamily', '') || localized(names, 'fontSubfamily', face.subfamilyName) || 'Regular';
  const fullName = localized(names, 'fullName', face.fullName) || `${family} ${subfamily}`;
  const postscriptName = typeof face.postscriptName === 'string' ? face.postscriptName : '';
  const identity = bundled ? `bundled:${bundled.identity}` : keyFor(file);
  return {
    id: hash(`${identity}#${index}#${postscriptName}`).slice(0, 32), family, subfamily, fullName, postscriptName,
    source: file, hasChinese: bundled ? bundled.languages.some(language => language.startsWith('zh-')) : [0x4e2d, 0x6587, 0x6807].every(cp => face.hasGlyphForCodePoint(cp)), faceIndex: index,
    ...(bundled ? { bundled: true, languages: bundled.languages, license: bundled.license } : {}),
  };
}
function facesOf(font) { return font.fonts || [font]; }
function priority(font) {
  const name = `${font.family} ${font.subfamily} ${font.fullName} ${font.postscriptName}`;
  return (font.hasChinese ? 100 : 0) + (font.bundled && font.family === 'Noto Sans SC' ? 60 : 0) + (/bold|heavy|black|粗|黑体|黑體/i.test(name) ? 30 : 0) + (/MicrosoftYaHei-Bold|微软雅黑.*(Bold|粗)/i.test(name) ? 100 : 0) + (/SourceHanSans|思源黑|NotoSansCJK|阿里巴巴/i.test(name) ? 10 : 0) - (/UI/i.test(name) ? 5 : 0);
}
function systemDirectories() {
  if (options.includeSystemFonts === false) return [];
  if (process.platform === 'win32') return [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Microsoft/Windows/Fonts')];
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.local/share/fonts'), path.join(os.homedir(), '.fonts')];
}
async function registeredFiles() {
  if (process.platform !== 'win32' || options.scanRegistry === false || options.includeSystemFonts === false) return [];
  const script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $values = @(foreach ($p in @('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','Registry::HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')) { if (Test-Path -LiteralPath $p) { $k = Get-Item -LiteralPath $p; foreach ($n in $k.GetValueNames()) { $v = $k.GetValue($n); if ($v -is [string]) { $v } } } }); ConvertTo-Json -InputObject $values -Compress";
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  const entries = JSON.parse(stdout.replace(/^\uFEFF/, '') || '[]');
  return entries.filter(value => typeof value === 'string' && extensions.has(path.extname(value).toLowerCase())).map(value => path.isAbsolute(value) ? value : path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', value));
}
async function discover(directories, errors) {
  const files = new Map();
  const roots = [];
  const visited = new Set();
  const addFile = async file => {
    try {
      const canonical = await realpath(file);
      if (files.has(keyFor(canonical))) return;
      const info = await stat(canonical);
      if (info.isFile() && extensions.has(path.extname(canonical).toLowerCase())) files.set(keyFor(canonical), { file: canonical, size: info.size, mtimeMs: info.mtimeMs });
    } catch (error) { errors.push(`${file}: ${error.code || error.message}`); }
  };
  const walk = async (directory, depth = 0) => {
    if (depth > 32) { errors.push(`${directory}: 目录嵌套过深`); return; }
    const canonical = await realpath(directory);
    if (visited.has(keyFor(canonical))) return;
    visited.add(keyFor(canonical));
    const entries = await readdir(canonical, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(canonical, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1).catch(error => errors.push(`${file}: ${error.code || error.message}`));
      else if (entry.isFile() && extensions.has(path.extname(file).toLowerCase())) await addFile(file);
      if (files.size > 30000) throw new ApiError(413, '字体目录超过 30000 个文件');
    }
  };
  const registry = registeredFiles().catch(error => { errors.push(`Windows 字体注册表: ${error.message}`); return []; });
  for (const directory of directories) {
    try {
      const canonical = await realpath(directory);
      if (!roots.some(root => keyFor(root) === keyFor(canonical))) roots.push(canonical);
      await walk(canonical);
    } catch (error) {
      if (error.status) throw error;
      if (error.code !== 'ENOENT' || config.directories.includes(directory)) errors.push(`${directory}: ${error.code || error.message}`);
    }
  }
  for (const file of await registry) await addFile(file);
  return { files, roots };
}
async function bundledFiles(errors) {
  if (options.includeBundledFonts === false) return [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(bundledDir, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.fonts)) throw new Error('内置字体清单格式无效');
  } catch (error) {
    errors.push(`内置字体: ${error.code || error.message}`);
    return [];
  }
  const entries = [];
  const identities = new Set();
  for (const bundled of manifest.fonts) {
    try {
      if (typeof bundled.identity !== 'string' || !bundled.identity || identities.has(bundled.identity)) throw new Error('内置字体身份为空或重复');
      identities.add(bundled.identity);
      if (typeof bundled.file !== 'string' || path.isAbsolute(bundled.file)) throw new Error('内置字体路径无效');
      if (!/^[a-f0-9]{64}$/.test(bundled.sha256) || !Number.isSafeInteger(bundled.size) || bundled.size <= 0) throw new Error('内置字体校验信息无效');
      if (typeof bundled.family !== 'string' || !bundled.family || typeof bundled.license !== 'string' || !Array.isArray(bundled.languages) || !bundled.languages.every(language => ['zh-Hans', 'zh-Hant', 'en'].includes(language))) throw new Error('内置字体元数据无效');
      const file = await realpath(path.resolve(bundledDir, bundled.file));
      const relative = path.relative(await realpath(bundledDir), file);
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || !extensions.has(path.extname(file).toLowerCase())) throw new Error('内置字体路径超出资源目录');
      const info = await stat(file);
      if (!info.isFile() || info.size !== bundled.size) throw new Error('内置字体文件大小与清单不符');
      entries.push({ file, size: info.size, mtimeMs: info.mtimeMs, bundled, bundleKey: hash(JSON.stringify(bundled)) });
    } catch (error) { errors.push(`内置字体 ${bundled?.family || bundled?.file || ''}: ${error.code || error.message}`); }
  }
  return entries;
}
async function scan() {
  const errors = [];
  const directories = [...systemDirectories(), ...(options.fontDirectories || []), ...config.directories, importedDir];
  const { files, roots } = await discover(directories, errors);
  const bundled = await bundledFiles(errors);
  if (bundled.length && !roots.some(root => keyFor(root) === keyFor(bundledDir))) roots.push(bundledDir);
  for (const entry of bundled) files.set(keyFor(entry.file), entry);
  const nextCache = {};
  records = new Map();
  for (const [key, entry] of files) {
    let item = cache[key];
    if (item?.size === entry.size && item?.mtimeMs === entry.mtimeMs && item.bundleKey === entry.bundleKey && Array.isArray(item.faces)) statistics.metadataCacheHits++;
    else {
      item = { size: entry.size, mtimeMs: entry.mtimeMs, bundleKey: entry.bundleKey, faces: [] };
      try {
        if (entry.size > maxFontBytes) throw new Error('字体文件超过 128 MiB');
        const bytes = await readFile(entry.file);
        if (entry.bundled && hash(bytes) !== entry.bundled.sha256) throw new Error('内置字体 SHA-256 与清单不符');
        const font = fontkit.create(bytes);
        item.faces = facesOf(font).map((face, index) => metadata(face, entry.file, index, entry.bundled));
        if (!item.faces.length) throw new Error('字体集合为空');
        statistics.filesParsed++;
      } catch (error) { item.error = error.message; }
    }
    nextCache[key] = item;
    if (item.error) errors.push(`${entry.file}: ${item.error}`);
    for (const record of item.faces) records.set(record.id, { ...record, size: entry.size, mtimeMs: entry.mtimeMs });
  }
  cache = nextCache;
  await atomicJson(cachePath, { version: metadataCacheVersion, files: cache });
  const fonts = [...records.values()].map(({ faceIndex, size, mtimeMs, ...record }) => record);
  fonts.sort((a, b) => Number(b.hasChinese) - Number(a.hasChinese) || a.family.localeCompare(b.family, 'zh-CN') || a.subfamily.localeCompare(b.subfamily, 'zh-CN') || a.id.localeCompare(b.id));
  const preferred = [...fonts].sort((a, b) => priority(b) - priority(a))[0];
  catalog = { fonts, defaultFontId: preferred?.id || '', directories: roots, errors };
  return catalog;
}
async function initialize() {
  await mkdir(importedDir, { recursive: true });
  const saved = await readJson(configPath, {});
  config.directories = Array.isArray(saved.directories) ? saved.directories.filter(value => typeof value === 'string' && path.isAbsolute(value)) : [];
  const savedCache = await readJson(cachePath, {});
  cache = savedCache.version === metadataCacheVersion && savedCache.files && typeof savedCache.files === 'object' ? savedCache.files : {};
  return scan();
}
async function addDirectory(value) {
  if (!value || typeof value.path !== 'string' || !path.isAbsolute(value.path) || value.path.length > 4096 || value.path.includes('\0')) throw new ApiError(400, '请输入字体目录的绝对路径');
  let directory;
  try {
    directory = await realpath(value.path);
    if (!(await stat(directory)).isDirectory()) throw new Error('不是目录');
  } catch { throw new ApiError(400, '字体目录不存在或不可读'); }
  if (!config.directories.some(item => keyFor(item) === keyFor(directory))) {
    config.directories.push(directory);
    await atomicJson(configPath, config);
  }
  return scan();
}
async function importFont(value) {
  if (!value || typeof value.name !== 'string' || value.name.length > 200 || /[\\/:\x00-\x1f]/.test(value.name) || value.name !== path.basename(value.name) || !extensions.has(path.extname(value.name).toLowerCase())) throw new ApiError(400, '字体文件名或格式无效');
  if (typeof value.data !== 'string' || !value.data.length || value.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new ApiError(400, 'data 必须为有效的 base64');
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length > 80 * 1024 * 1024) throw new ApiError(413, '导入字体超过 80 MiB');
  if (bytes.toString('base64') !== value.data) throw new ApiError(400, 'base64 编码无效');
  try {
    const faces = facesOf(fontkit.create(bytes));
    if (!faces.length) throw new Error('empty font');
    faces.forEach((face, index) => metadata(face, value.name, index));
  } catch { throw new ApiError(400, '文件不是可读取的字体'); }
  const file = path.join(importedDir, `${hash(bytes).slice(0, 16)}-${value.name}`);
  await writeFile(file, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return scan();
}
async function getFace(id) {
  const record = records.get(id);
  if (!record) throw new ApiError(404, '字体不存在，请刷新字体列表');
  const key = keyFor(record.source);
  let info;
  try { info = await stat(record.source); } catch { throw new ApiError(404, '字体源文件已移动或删除'); }
  let entry = loaded.get(key);
  if (entry && (entry.size !== info.size || entry.mtimeMs !== info.mtimeMs)) {
    loadedBytes -= entry.size;
    loaded.delete(key);
    entry = null;
  }
  if (!entry) {
    if (info.size > maxFontBytes) throw new ApiError(413, '字体文件超过 128 MiB');
    try { entry = { font: fontkit.create(await readFile(record.source)), size: info.size, mtimeMs: info.mtimeMs }; }
    catch { throw new ApiError(422, '读取字体失败'); }
    loaded.set(key, entry);
    loadedBytes += entry.size;
    while (loaded.size > 4 || (loadedBytes > 96 * 1024 * 1024 && loaded.size > 1)) {
      const oldest = loaded.keys().next().value;
      loadedBytes -= loaded.get(oldest).size;
      loaded.delete(oldest);
    }
  } else {
    statistics.outlineCacheHits++;
    loaded.delete(key);
    loaded.set(key, entry);
  }
  entry.faces ||= facesOf(entry.font);
  const face = entry.faces[record.faceIndex];
  if (!face) throw new ApiError(422, '字体集合内容已改变，请重启服务刷新');
  return face;
}

let initialized;
let queue = Promise.resolve();
parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      initialized ||= initialize();
      await initialized;
      let result;
      switch (message.operation) {
        case 'catalog': result = catalog; break;
        case 'refresh': result = await scan(); break;
        case 'directory': result = await addDirectory(message.value); break;
        case 'import': result = await importFont(message.value); break;
        case 'outline': validateOutline(message.value); result = outlineFont(await getFace(message.value.fontId), message.value); break;
        case 'stats': result = { ...statistics, loadedFiles: loaded.size, loadedBytes }; break;
        default: throw new ApiError(400, '未知字体操作');
      }
      parentPort.postMessage({ id: message.id, result });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: { status: error.status || 500, message: error.status ? error.message : '字体处理失败', detail: error.message } });
    }
  });
});
