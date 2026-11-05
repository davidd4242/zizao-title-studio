import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * 把已经打好的 Photoshop 面板包（Zizao-Photoshop-1.5.0.zip 解压出来的
 * com.zizao.title-studio 目录）编译成一个双击即安装的 EXE。
 *
 * 为什么不是再包一层 ZIP：资源管理器的 zipfldr 对 data descriptor 和上万个小
 * 文件很脆弱（用户已经踩到 0x80004005）。NSIS 自己解包，没有那层风险。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const version = arg('version', JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version);
const bundle = path.resolve(arg('bundle', ''));
if (!bundle || !existsSync(bundle)) throw new Error('--bundle must point at the unpacked Zizao-Photoshop-<version> directory');
const payload = path.join(bundle, 'com.zizao.title-studio');
if (!existsSync(path.join(payload, 'package-manifest.json'))) throw new Error(`payload missing package-manifest.json: ${payload}`);
const readme = path.join(bundle, 'README.zh-CN.md');
const output = path.resolve(arg('output', path.join(root, `release/字造-Photoshop插件-安装版-${version}.exe`)));
const makensis = arg('makensis', 'C:/Users/DAVID/AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/makensis.exe');
if (!existsSync(makensis)) throw new Error(`makensis not found: ${makensis}`);

const script = path.join(root, 'desktop/plugin-installer.nsi');
if (!existsSync(script)) throw new Error(`nsi script missing: ${script}`);

mkdirSync(path.dirname(output), { recursive: true });
if (existsSync(output)) rmSync(output, { force: true });

const [major, minor, patch] = version.split('.');
const version4 = `${major}.${minor}.${patch}.0`;

const started = Date.now();
execFileSync(makensis, [
  '/V2',
  `/DPAYLOAD=${payload.replace(/\//g, '\\')}`,
  `/DOUTFILE=${output.replace(/\//g, '\\')}`,
  `/DVERSION=${version}`,
  `/DVERSION4=${version4}`,
  `/DREADME=${readme.replace(/\//g, '\\')}`,
  script,
], { stdio: 'inherit', cwd: root });

const bytes = statSync(output).size;
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
console.log(JSON.stringify({
  ok: true,
  output,
  bytes,
  sha256,
  version,
  payload,
  makensis,
  seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
}, null, 2));
