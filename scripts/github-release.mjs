#!/usr/bin/env node
/*
 * 把当前仓库发布到 GitHub。
 *
 *   GITHUB_TOKEN=... node scripts/github-release.mjs --owner <user-or-org>
 *
 * 只做三件事，每一步都先查再做，重复执行安全：
 *   1. 仓库不存在就建（默认私有，--public 才公开）
 *   2. push main
 *   3. 可选：建 tag 与 Release，并上传交付目录里的安装包
 *
 * 为什么默认私有：仓库一旦公开，内容就被人抓走了，改回来也收不回；
 * 私有状态下点一下就能转公开，反悔成本低。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
// ghp_ 是 classic PAT，github_pat_ 是 fine-grained，gho_/ghu_/ghs_ 是 OAuth/GitHub App 令牌
// （Git Credential Manager 走的就是 gho_），原先把这几种挡在外面了。
if (!/^(ghp_|gho_|ghu_|ghs_|github_pat_)/.test(token || '')) {
  console.error('需要一个 GitHub token：GITHUB_TOKEN=ghp_... node scripts/github-release.mjs --owner <user>');
  process.exit(1);
}
const name = value('name', 'zizao-title-studio');
const visibility = flag('public') ? 'public' : 'private';
const description = value('description', '字造 · 封面标题工作室 —— 本地离线排封面标题，逐字排版、画布渐变、分层 PSD 导出');
const api = 'https://api.github.com';

async function call(method, url, body, headers = {}) {
  const response = await fetch(url.startsWith('http') ? url : api + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zizao-release',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok && response.status !== 404) {
    throw new Error(`${method} ${url} → ${response.status} ${text.slice(0, 400)}`);
  }
  return { status: response.status, data };
}

// 1. whoami —— token 属于谁，owner 必须对得上，否则 push 会 403 且报错很含糊。
const me = await call('GET', '/user');
if (!me.data?.login) throw new Error('token 无效：/user 没有返回 login');
const owner = value('owner', me.data.login);
const authed = await call('GET', '/user/repos?per_page=1');
const canCreate = authed.status === 200;
if (!canCreate) console.error('警告：token 可能缺少 Administration 权限，建仓会失败');

// 2. repo —— 存在就复用
let repo = (await call('GET', `/repos/${owner}/${name}`)).data;
if (!repo?.full_name) {
  const created = await call('POST', owner === me.data.login ? '/user/repos' : `/orgs/${owner}/repos`, {
    name, description, private: visibility !== 'public', has_issues: true, has_wiki: false, has_projects: false,
  });
  repo = created.data;
  console.log(`created ${repo.full_name} (${repo.private ? 'private' : 'public'})`);
} else {
  console.log(`reusing ${repo.full_name} (${repo.private ? 'private' : 'public'})`);
  // 已存在时 --public 仍然生效：私有转公开是用户明确要求的动作，脚本重复跑也不会出错。
  if (visibility === 'public' && repo.private) {
    const updated = await call('PATCH', `/repos/${owner}/${name}`, { private: false });
    repo = updated.data;
    console.log(`visibility ${repo.full_name} → ${repo.private ? 'private' : 'public'}`);
  }
}

const remoteUrl = `https://github.com/${owner}/${name}.git`;
const authUrl = `https://x-access-token:${token}@github.com/${owner}/${name}.git`;

// 3. push —— 远端已有历史时用 --force-with-lease 会拒绝，这里显式先 fetch 判断
const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
try { run('git', ['remote', 'remove', 'origin']); } catch {}
run('git', ['remote', 'add', 'origin', remoteUrl]);
const branch = run('git', ['branch', '--show-current']).trim() || 'main';
try {
  const out = run('git', ['push', authUrl, `${branch}:${branch}`]);
  console.log(out.trim().split('\n').slice(-2).join('\n'));
} catch (error) {
  console.error('push 失败：', (error.stderr || error.message || '').toString().split('\n').slice(-6).join('\n'));
  throw error;
}

// 4. Release —— 只有 --assets 才传二进制，680MB 不是每次都需要
if (flag('assets')) {
  const version = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8')).version;
  const tag = `v${version}`;
  const delivery = path.resolve(value('delivery', path.join(root, `../字造-${version}`)));
  const files = ['字造-1.5.0-完整安装版.exe', '字造-免安装.zip', '字造-Photoshop插件-安装版-1.5.0.exe'];
  for (const file of files) {
    if (!existsSync(path.join(delivery, file))) throw new Error(`交付文件缺失：${path.join(delivery, file)}`);
  }
  let release = (await call('GET', `/repos/${owner}/${name}/releases/tags/${tag}`)).data;
  if (!release?.id) {
    release = (await call('POST', `/repos/${owner}/${name}/releases`, {
      tag_name: tag,
      target_commitish: branch,
      name: `字造 ${version}`,
      body: '见 README。安装包未签名，Windows 可能显示 SmartScreen 提示。',
      draft: false,
      prerelease: false,
    })).data;
    console.log(`release ${tag} created`);
  } else {
    console.log(`release ${tag} exists, uploading missing assets only`);
  }
  const existing = new Set((release.assets || []).map(asset => asset.name));
  for (const file of files) {
    if (existing.has(file)) { console.log(`skip ${file} (already uploaded)`); continue; }
    const full = path.join(delivery, file);
    const bytes = statSync(full).size;
    const sha256 = createHash('sha256').update(await (await import('node:fs/promises')).readFile(full)).digest('hex');
    const upload = await fetch(`https://uploads.github.com/repos/${owner}/${name}/releases/${release.id}/assets?name=${encodeURIComponent(file)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'zizao-release',
      },
      body: createReadStream(full),
      duplex: 'half',
    });
    const text = await upload.text();
    if (!upload.ok) throw new Error(`上传 ${file} 失败 ${upload.status}: ${text.slice(0, 300)}`);
    console.log(`uploaded ${file} ${bytes} B sha256=${sha256}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  repository: repo.html_url,
  clone: remoteUrl,
  branch,
  visibility: repo.private ? 'private' : 'public',
  release: flag('assets') ? `v${JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8')).version}` : null,
}, null, 2));
