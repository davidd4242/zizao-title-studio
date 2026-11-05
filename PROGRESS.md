## 1.5.0 修订 4：Photoshop 面板显示 {"error":"拦截外站请求"}

- 用户截图：面板右上「编辑器已加载 · 等待桥连接」，正文只有 `{"error":"拦截外站请求"}`。
- 根因：`server/index.mjs` 的 `guardLocal()` 对无 Origin 且 `Sec-Fetch-Site: cross-site` 的请求一律 403。CEP 面板页是 file://，它的 iframe 导航到 `http://127.0.0.1:端口/?photoshop=cep` 正是这个形状，于是编辑器首页本身被拦。旧测试 `tests/photoshop-port.test.mjs` 的父页是 http://127.0.0.1，浏览器标 same-site，所以没抓到。
- 修法：`createServer({ allowFramedNavigation })`（默认 false）。仅当 GET/HEAD、`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: iframe`、且路径不是 `/api/`、`/__bridge/` 时放行跨站；`photoshop/runtime/server.mjs` 传 true。主程序行为不变；API 与桥仍要 token 且仍拦跨站。
- 测试（先红后绿）：新增「real Chromium iframe from a file:// panel page loads the editor」，修前 `editor document must not be rejected as cross-site` 失败，修后 Edge 156 实测 `Sec-Fetch-Site=cross-site` 下文档 200、编辑器加载；另加负向断言（非 iframe 目标、非导航、/api/、编码后的 /%61pi/、/__bridge/ 全 403；主服务默认对 iframe 导航仍 403）。`npm test` 119/119。
- 打包后实测 `verification/cep-file-iframe-test.mjs`：用插件包自带 `runtime/node.exe` + `runtime/server.mjs` 启动、file:// 页嵌 iframe → 文档 200、无拦截文字、编辑器加载、无 token 的 /api/fonts 403、带 token 200、无页面错误。
- 产物：插件 zip 141763166 `c580fb87…`；插件安装版 87935788 `189dc608…`（`plugin-installer-test` 8219 文件 missing 0 / mismatched 0，卸载干净、注册表还原）；主安装包 343193143 `7be3a187…`（verify-installer 6316/6316、install/verified/uninstall 全过）；`sha256sum -c` 11 项 OK。
- 用户已装的旧面板仍是坏的，需要关掉 Photoshop 后重新运行插件安装版。

## 1.5.0 修订 3：Photoshop 面板改成双击即装的 EXE

- 用户要求（原话）：「看看能不能做成一个exe安装包，点击就安装插件」。原因很直接：ZIP 里有 8200 多个文件，解压这一步本身就是故障源（data descriptor 报 0x80004005、杀软删 ttf、中途取消），装面板不该要求用户先当解压工程师。
- 做法：新增 `desktop/plugin-installer.nsi`（NSIS 3.04，`Unicode true`、`SetCompressor /SOLID lzma`、`RequestExecutionLevel user`，安装到 `$APPDATA\Adobe\CEP\extensions`），由 `scripts/package-plugin-installer.mjs` 从**已经解压好**的 `Zizao-Photoshop-1.5.0` 载荷编译，产物 `release/字造-Photoshop插件-安装版-1.5.0.exe`，87937676 B，sha256 `61cb7ad17fcc2b49a91791fa8062e3a730faa2a90434b42fc746a942cdb6368e`。
- 安装只做两件事：把 `com.zizao.title-studio` 放进 CEP 扩展目录，以及 `WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"`。安装前的原值记进 `HKCU\Software\Zizao\PhotoshopPanel`，卸载时按 `absent`/`string` 两种情况原样还原，然后删掉这个键和扩展目录。
- 实测（`verification/plugin-installer-test.mjs`，静默 `/S /D=` 装到隔离目录，绝不碰 `%APPDATA%` 正式目录）：payload 8219 个文件、313,643,096 B 全部落地，`missing 0 / mismatched 0`，多出 3 个预期文件（`.zizao-install.ini`、`卸载字造面板.exe`、`字造面板说明.md`）；安装 10.0 s、卸载 1.5 s 后目录消失；`PlayerDebugMode` 在「原本是 1」与「原本不存在」两条分支都按原值还原（第二条实测 `debugBefore=null → afterInstall=1 → afterUninstall=null`）。
- 踩到的三个真坑，记在这里免得重犯：
  1. NSIS 的 `/D=` 只认**反斜杠**路径；传 `C:/x/y` 会被静默忽略并落回默认目录（第一次就这么把面板装进了真实的 `%APPDATA%` 扩展目录）。
  2. 卸载程序里的 `$INSTDIR` 不可靠（静默卸载时可能为空），`$EXEDIR` 指向的是临时副本目录；必须安装时把真实路径写进注册表，卸载时读回来。
  3. `.nsi` 必须 UTF-8 带 BOM，否则 `Bad text encoding: ... on line 1`；git-bash 直接调 makensis 还要 `MSYS2_ARG_CONV_EXCL='*'`，否则 `/V3` 被当成路径改写。
  另外 NSIS 卸载程序会把自己复制到临时目录再启动、原进程立即返回 —— 测试必须轮询等目录真的消失，不能读完退出码就断言。
- 交付：面板安装版写进 `F:/dnowload/封面/字造-1.5.0/`，`先看这里.txt` 的 Photoshop 段改成正推 EXE、ZIP 降为手动备选；`SHA256SUMS.txt` 11 项全部 OK。

## 1.5.0 修订 2：ZIP 用 data descriptor 导致资源管理器解压报 0x80004005（真因）

- 用户贴出真实报错截图：资源管理器「1 个已中断的操作 / 一个意外错误使您无法复制该文件 / 错误 0x80004005: 未指定的错误」，卡在 `AmaticSC-Regular.ttf`。这不是解压被中断，而是归档格式问题。
- 根因（实测）：`scripts/package-photoshop.mjs` 用 fflate 流式 `Zip`+`ZipDeflate`，`pack-standalone.mjs` 用 `Zip`+`AsyncZipDeflate`，两个包的全部条目都带 **通用标志位 bit 3（data descriptor）**，即本地头里 CRC/压缩后大小/原始大小都写 0、真正的值放在数据后面的描述符里。旧插件包 8224 条、免安装包 6558 条，`bit3` 计数等于条目总数。.NET（Expand-Archive）与 7-Zip 能容错，Windows 资源管理器的 zipfldr 会报 0x80004005。
- 修法：新增 `scripts/zip-writer.mjs`——尺寸与 CRC 事先已知，所以直接写进本地头，bit 3 保持 0；同时写 250/243 个目录条目、所有条目置 UTF-8 标志 0x800、时间戳固定为 1980-01-01 以便复现。两个打包脚本改为调用 `writeZip`。
- 验收（全实测）：
  - 新插件包 `build-1793883303403/Zizao-Photoshop-1.5.0.zip` 141762773 B `a71cf3e1…`，8474 条目（250 目录 + 8224 文件），`bit3=0`、UTF-8 标志 8474/8474；
  - 新免安装包 `release/1.5-final/wrapped/字造-免安装.zip` 249085674 B `bf619fca…`，6560 条目（243 目录 + 6316 文件 + 先看这里.txt），`bit3=0`；
  - 走资源管理器同一条 Shell/zipfldr 通道（`Shell.Application CopyHere`）解压：插件 8224 个文件、免安装 6317 个文件，与源目录逐文件 sha256 比对 `missing 0 / extra 0 / contentMismatch 0`；
  - NSIS 重建 `release/字造-1.5.0-完整安装版.exe` 343192557 B `86242e30…`；`verify-installer` → `6316/6316 byte-identical`；`install-smoke` → `exit=0 rootFiles=17 desktopShortcuts=3`（插件 141762773）；`verify-installed` → `INSTALLED VERIFIED`；`uninstall-smoke` → `uninstallExit=0 installDirExists=False`；
  - `sha256sum -c SHA256SUMS.txt` 10 项 OK；`npm test` 118/118。
- 教训：给 Windows 用户分发的 zip 不要用流式写入器。本地头写 0 的 data descriptor 在 .NET/7-Zip 下看不出问题，只会在资源管理器里炸，而且报错是笼统的 0x80004005。

## 1.5.0 修订：PS 插件包解压不完整（用户报告「zip解压有问题」）

- 用户反馈（2026-11-05）：`字造-Photoshop插件.zip` 解压有问题。实测交付目录里用户两次解压的结果分别缺 **19 / 80** 个文件：
  - `Zizao-Photoshop-1.5.0/` 8205 文件 / 250 目录，缺 19 个（全是 `.ttf`，如 `fonts/anton/Anton-Regular.ttf`、`fonts/caveat/Caveat[wght].ttf`）；
  - `字造-Photoshop插件/Zizao-Photoshop-1.5.0/` 8144 文件 / 251 目录，缺 80 个（19 个 ttf + `@swc/helpers/src/*.mjs` 等）。
- 归档本身没有坏：`Expand-Archive` 解出 8224 个文件；条目无非法字符、无重复名、`missingMaxPathLength` 仅 141（远低于 260）；三个解压引擎结果逐字节一致；从完整解压目录跑 `Install.ps1` 时 8224 个文件全部通过 size+sha256 校验。结论是解压在用户侧被中断或被杀毒软件删除，不是压缩包损坏。
- 可诊断性修复（`photoshop/Install.ps1`）：原来遇第一个缺失文件就 `throw "Package file missing: ..."`，用户看不出该怎么办。改为先收集缺失/损坏清单再抛：`Package is incomplete: {n} of {total} files are missing and {m} are damaged (for example: {file}). The ZIP was not fully extracted, or an antivirus removed files while it was unpacking. Delete this folder, extract the whole ZIP again into an empty folder, let it finish without cancelling, then run Install.cmd again.`
- 实测（`verification/plugin-completeness-test.ps1`，把新包 `Expand-Archive` 到 `C:/zizao-probe/ps-plugin-new`）：
  - 删掉 `Anton-Regular.ttf` → `INCOMPLETE-RUN exit=1`，报文点名 `packages/editor/assets/fonts/anton/Anton-Regular.ttf`；
  - 文件放回 → `COMPLETE-RUN exit=0`、`Installed Zizao 1.5.0`、目标目录 8219 个文件；
  - 解压文件数 8224，与包内条目数一致。
- 文案同步：`photoshop/README.zh-CN.md` 第 1 步与 `photoshop/Install.cmd` 的 errorlevel 提示都写清「8200 多个文件、解压要一两分钟、中途别取消、报 incomplete 就重新完整解压」；交付目录 `先看这里.txt` 的 Photoshop 段加了同一句。
- 重打包：`node scripts/package-photoshop.mjs` → `build-1793882262399/Zizao-Photoshop-1.5.0.zip` 143257393 B sha256 `0a2a697918d840800a76abbb2e62d766836d733ceb9b90ad938ff167ba49d689`（旧包 `e6b585e1…`）。
- 免安装包同时改为**带顶层文件夹**：`scripts/pack-standalone.mjs`（fflate 流式，level 9）+ `scripts/verify-standalone.mjs`（断言顶层只有 `字造-1.5.0`、6316 个文件逐 sha256 相同），产物 `release/1.5-final/wrapped/字造-免安装.zip` 250278455 B sha256 `1660b9a3a7dabd4e33417b5d6d96ed71e674c9a78db7786101637afc5a26bb9d`，避免「解压到当前文件夹」把 6316 个文件撒到桌面。
- 重新发布实测：NSIS `release/字造-1.5.0-完整安装版.exe` 344570953 B sha256 `c2793bafb0677b04247e09a310dfa243c10157d5bfad4662b4eae4a35104f1df`；`verify-installer.mjs` → `APP files 6316/6316 byte-identical` / `INSTALLER VERIFIED`；`install-smoke.ps1` → `exit=0 rootFiles=17 desktopShortcuts=3`（extra：先看这里 2442、插件 143257393、练习 625684、长图 8037403）；`verify-installed.mjs` → `INSTALLED VERIFIED` 四个 EXTRA match=true；`uninstall-smoke.ps1` → `uninstallExit=0 installDirExists=False`；`sha256sum -c SHA256SUMS.txt` 10 项 OK。
- 交付目录里那两份旧的失败解压已改名为 `Zizao-Photoshop-1.5.0.不完整解压-可删` 与 `字造-Photoshop插件.不完整解压-可删`（不删除用户文件，但避免继续从缺文件的目录跑旧安装脚本）。

## 1.5.0 单字变换框（实测）

用户需求：双击单字后出现图片 2 那样的变换框，可以单独放大、旋转这个字。

- 数据：`src/types.ts` 的 `Glyph` 增加可选 `scaleX`/`scaleY`；`src/project.ts` 校验有限、>0、≤20，非法值抛 `字形缩放不正确`；`src/engine.ts` 的 `glyphPoint` 改成先绕自身中心缩放再旋转，缺省值等于 1，旧工程渲染逐字节不变（测试 ②）。
- 几何：新文件 `src/glyph-transform.ts`：`glyphCorners`、`resizeGlyph(glyph, corner, point, uniform)`（返回 scaleX/scaleY/x/y，绕对角锚点补偿位移）、`rotateGlyph(glyph, start, current, snap)`（增量、15° 吸附、归一到 (-180,180]）。
- 画布：`src/Canvas.tsx` 的 glyph 模式改为每个字一个虚线框 + `onPointerDown` 内判定双击（<450ms、位移 <8px）。**为什么不在 `onDoubleClick` 里做**：`begin()` 会 `setPointerCapture(svg)`，Chromium 把后续 click/dblclick 重定向到 svg，挂在 path 上的 `onDoubleClick` 永远不触发——这条是浏览器验收先红后绿的直接证据。
- 交互：`glyph-scale`/`glyph-rotate` 两种拖拽，拖动走 `onDraft`，松手 `onCommit` 一次；方向键 1°、Shift 15°；390 宽下变换框仍在页面内。
- 数值：`src/App.tsx` 单字排版面板新增「单字缩放 X/Y」（0.05–20，step 0.05），与手柄双向同步。

实测：

- `npx tsc -p tsconfig.json --noEmit` exit 0。
- `npm test`：118 tests / 118 pass / 0 fail，`duration_ms 21022.2807`（111 + 新增 `tests/glyph-transform.test.mjs` 7 项）。
- `node scripts/verify-glyph-browser.mjs`：18 checks passed（真实 Edge + 生产 dist）；角点拖拽 → `scaleX 1.997 / scaleY 1.487`，像素 maxRGB 255 / 19280 像素变化；旋转柄 Shift 拖 → `60°`，像素 maxRGB 255 / 6833 像素变化；一次手势 `history.past` +1，Ctrl+Z 后整个工程深等；390×844 下 `scrollWidth=390` 且角点在视口内。产物 `verification/glyph-transform-1.5/`（`results.json`、`glyph-box.png`、`glyph-rotated.png`、`glyph-mobile.png`）。
- 构建与原生验收：见 `PACKAGING.md` 的 1.5.0 一节（31 checks、安装/卸载逐文件、5 PASS ZIP）。
- 长图：`output/manual-1.5`，1600×32629，27 章 / 26 图，第 13 章补入变换框与「单字缩放 X/Y」；`sha256 6d99d062…64fbb`。

# 字造工作进度

## 1.4.0 构建与发布（实测）

### 源码冻结与最终 dist

- 冻结时间：`src/` 最后一次改动 18:14，之后 12 分钟无改动；`npm run build` exit 0，`built in 2.41s`。
- dist 整体指纹（`find dist -type f | sort | xargs sha256sum | sha256sum`）：`38c82622230fcff70a82edab7d0003bc4d5ea28934593330c5ca6eee96577e2d`。长图截图开工前与截完后各核一次，两次相同。
- 单文件：`index.html` `b58485ff…`；`index-CPofi96k.js` 364437B `d9914e12…`；`index-DjxWgh-N.css` 71005B `66f947ca…`；`index-DoIuPVOw.js` 520811B `d068e77f…`；`layer-actions-CloWQoWf.js` 13711B `ab801fb5…`。

### 测试

- `npm test`：111 tests / 111 pass / 0 fail，exit 0（原 99 项全在前 99 里，新增 12 项）。三次独立运行耗时 17759.8373 / 19840.2366 / 22363.2054 ms，fail 全是 0。
- `node --test tests/psd-elements.test.mjs`：4/4；17 cases / 54 leaves 全部 α0 / RGB0。
- 冻结后整轮复跑（`verification/psd-1.4/final-verify.mjs`，入口 exit 0）：17 cases / 54 leaves，叶层与重组最大 α=0、预乘 RGB=0，合成图 α=0、预乘 RGB=1.3254901960784267（<1.5 白底量化界限）；六份产品文件前后 SHA-256 全部 unchanged；日志 `verification/psd-1.4/final-psd.log`、`final-npm-test.log`、`final-tsc.log`，回执 `verification/psd-1.4/final-verification.json`。第一次跑因验证脚本 cmd 引号转义失败，原始失败证据保留在 `verification/psd-1.4/failed-2026-11-05T11-11-23.861Z/`。
- `npx tsc -p tsconfig.json --noEmit`：exit 0，无输出。
- 断言强度对照基线：`tests/` 只新增 `gradient.test.mjs`、`psd-elements.test.mjs`；`photoshop-port.test.mjs` 的 assert 由 27 增至 32（新增的是端口回退与 iframe 断言），其余 16 个测试文件 assert 条数与基线完全相同；`scripts/verify-psd.mjs` 与基线逐字节相同。

### 渐变浏览器验收（生产 dist，62 checks，exit 0）

`node scripts/verify-gradient-browser.mjs` → 62 browser checks，exit 0，零 outline 请求、零 Edge 运行错误，报告 `verification/gradient-1.4/results.json`：

1. 角度 +30°：PNG maxRGB 95，变化像素 16709。
2. 终点在屏幕上拖 40px：maxRGB 37，变化像素 16623；拖拽中 8 次采样的字形 `d` 逐字符未变（前后首 40 字符均为 `M20 10 L120 10 L120 90 L20 90 Z|M160 10 `，尾 40 字符均为 `0 90 Z|M160 10 L260 10 L260 90 L160 90 Z`），即拖动不重建轮廓。
3. 真实 `history.past`（只读 React ref）1→2，增量 1；Ctrl+Z 后整个 project 深等（含 style 全部字段与归一化 start/end）为 true。
4. 390×844：`documentElement.scrollWidth=390`；渐变面板 scrollWidth/clientWidth = 390/390；导出面板 x=12、right=378；起点、终点手柄均命中且可聚焦。

### 构建与原生验收

- `npx electron-builder --config desktop/builder.cjs --win portable --x64` exit 0，`release/win-unpacked` 6316 文件 513103288 B；`release/字造.exe` 166714039 B。
- `node tests/desktop.mjs --unpacked release/win-unpacked/字造.exe` → `DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0`。
- `node scripts/package-photoshop.mjs` exit 0：8218 文件、unpacked 311905431 B、zip 143255521 B `b8af2a14a29b7f337665472614c8a4741c813204660986c1ab44c679b7153162`。
- `npx electron-builder --config desktop/builder-installer.cjs --win nsis --x64 --prepackaged release/win-unpacked` exit 0 → `release/字造-1.4.0-完整安装版.exe` 344291144 B `7ff62a164d055a4ef7eaafd93629275831c1019f1aa5cfc0eedd2eb054e44ba5`。
- `node scripts/verify-installer.mjs` → `INSTALLER 344291144 bytes sha256=7ff62a16…`、`APP files 6316/6316 byte-identical`、`INSTALLER VERIFIED`。
- `powershell -File scripts/install-smoke.ps1` → `exit=0`、`rootFiles=17`、`desktopShortcuts=3`，四个附加文件（先看这里 1890、Photoshop 插件 143255521、练习素材 625687、长图 7765948）齐全。
- `node scripts/verify-installed.mjs` → `APP 6316/6316 byte-identical`、四个 EXTRA 全部 `match=true`、`INSTALLED VERIFIED`。
- `powershell -File scripts/uninstall-smoke.ps1` → `uninstallExit=0`、`installDirExists=False`、快捷方式与卸载登记都已清空。
- `node scripts/package-startup.mjs --final-startup-build-ready --input release/win-unpacked --version 1.4.0 --output release/1.4-final/字造-免安装.zip` → 5 PASS，`{"ok":true,"checks":5}`；源目录 6316 文件 513103288 B `b8ff78bc…`。

### 长图说明书

- `node output/manual-1.4/finalize-manual.mjs` exit 0：`MANUAL VERIFIED: 1600x32736; chapters=27; screenshots=26; sectionHashes=27; visualReview=passed; sha256=a118fa197a21809845af61ba3424fae83a3cbc433dfffda5d9f1c7f8dc4b6264`。
- 27 章 = 1.3 的 24 章 + 新增第 8 章（画布渐变手柄）、第 9 章（色标条）、第 24 章（PSD 导出分层）。26 张截图全部为真实运行界面，`capture` 收尾 `MANUAL CAPTURE passed: 26 screenshots, 0 page errors`。
- 首版 27 章渲染高度 36945 px，超出 32760 上限；没有改断言，改 4 轮 CSS 密度（正文 28px/1.53、章间 20px、图最大高 820px、表格 24px）后落到 32736 px。逐章实读结论见 `output/manual-1.4/evidence/final-visual-review.md`。

### 交付目录

`F:/dnowload/封面/字造-1.4.0/`：

| 文件 | 字节 | SHA-256 |
| --- | --- | --- |
| `字造-1.4.0-完整安装版.exe` | 344291144 | `7ff62a164d055a4ef7eaafd93629275831c1019f1aa5cfc0eedd2eb054e44ba5` |
| `字造-免安装.zip` | 239429579 | `46c34bcd497a40c51b90b26b25d98c0a2a4bdcddbc54fe3647c6a5342bfb3592` |
| `字造-Photoshop插件.zip` | 143255521 | `b8af2a14a29b7f337665472614c8a4741c813204660986c1ab44c679b7153162` |
| `字造-零基础图文说明书-长图.png` | 7765948 | `a118fa197a21809845af61ba3424fae83a3cbc433dfffda5d9f1c7f8dc4b6264` |
| `字造-练习素材.zip` | 625687 | `2c2dc85dee4c0880496256b53ec7e8b5d9b1af654c2f408116645d41eb4ab14d` |
| `先看这里.txt` | 1890 | `195364619496af978b27347733561c4a650826adf375a428672f80b1a611b4d6` |
| `可选单文件/字造.exe` | 166714039 | `fef4366e56328c668431ecd47aa5b3237cadc1ef6270abb5855d26c1e3d05aaa` |
| `SHA256SUMS.txt` | 975 | `68ea6c17b40bb5a5a1666f545d66ff0fd1ced7fdfe29765b7131a78d78785fd7` |
| `manifest.json` | 2606 | `7ecc89f22d78cb9b950667e1c5e05596f0438cac63676a03cee9c117fe87d30c`（`verification/release-1.4.0.json` 的副本） |

`SHA256SUMS.txt` 覆盖上表除 `manifest.json` 外的全部 10 个载荷文件（`manifest.json` 是记录本身，不自我引用），`sha256sum -c SHA256SUMS.txt` 逐项 OK。`字造-1.2.0`、`字造-1.3.0` 两个旧目录未改动。

安装包未签名，Windows 会给出常规 SmartScreen 提示，`先看这里.txt` 里保留了这句说明。

## 1.4.0 决策记录（已完成，见下）

本节只写已经实测或已定死的判定，构建与发布数字在收尾时补。

### 端口 4200：EACCES 也必须回退（已修，4/4 通过）

- 证据：`node -e "require('net').createServer().listen(4200)"` → `listen EACCES: permission denied 127.0.0.1:4200`；`netsh interface ipv4 show excludedportrange protocol=tcp` 列出 `4180-4279` 被 Windows 保留；`netstat` 无进程占用 4200。也就是 4200 不是被谁占用，而是被系统排除，任何人都绑不上。
- 旧逻辑 `photoshop/runtime/server.mjs:40-41` 只对 `EADDRINUSE` 回退，所以本机 CEP 编辑器永远起不来。这是产品缺陷，不只是测试前置条件问题。
- 现逻辑：只有调用方没指定端口时才回退，`EADDRINUSE || EACCES || EPERM` 都触发；显式 `port` 仍然原样抛错，回退契约不变。
- 测试前置条件改为自适应，断言语义没有放宽：`node --test tests/photoshop-port.test.mjs` → `tests 4 / pass 4 / fail 0`，日志含 `Fallback 1: 53439`、`Fallback 2: 64546`、`Default port 4200 is reserved by Windows (excluded port range), so EACCES drove the same fallback`、`Edge 156.0.4314.58 loaded http://127.0.0.1:53439/?photoshop=cep in a real iframe`、`Explicit zero: 57150`。

### 渐变：判定语义与 Photoshop 的差异

- 判定语义：渐变定义在图层局部归一化坐标 0-1。线性由起点/终点给出，径向由圆心 + `radiusX`/`radiusY` 给出。预览、PNG、逐层 PNG、SVG、PSD 两种模式共用同一份几何：`engine` 的 `gradientGeometryToPixels` 只做「归一化坐标 → 该图层渲染帧像素」的映射，不存在画布一套、导出一套。
- 角度不是唯一真值：`gradientAngle` 退化为兼容字段。只有 `gradientAngle` 的旧工程仍走 1.3 的原始分支，逐像素不变；该分支的角度约定沿用 1.3 实现，0° 指向右（+x），90° 指向下（+y，SVG 坐标），即 90° 是从上到下。
- 与 Photoshop 的差异：PS 的渐变填充按 objectBoundingBox 用角度 + 缩放构造；我们给出显式端点与独立的 `radiusX`/`radiusY`，不依赖角度约定，也不受包围盒纵横比牵制（等效于 PS 的非等比缩放）。
- 色标中点：1.4 的实现是在两个色标之间插入一个「两端颜色取平均」的中间色标（`gradientRenderStops`），位置由 `midpoint` 决定。这是折线近似，能把过渡的 50% 位置精确挪到中点，但曲线形状与 PS 的非线性中点不同。因为 PS 侧数值没有实测，这里只声明我们自己的语义，不宣称与 PS 等价。
- Adobe 官方文档：`https://helpx.adobe.com/photoshop/using/gradients.html` 返回 HTTP 200，302 到 `/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html`；正文由脚本渲染，抓取只拿到导航壳，因此没有引用条目原文。
- Photoshop 实机数值核对：**未做**。`rea` 搜索 `Photoshop gradient documentation` 返回 `total:0`，没有可引用的渐变资料。`Document.gradientFill()` 在 PS 27.11 上直接挂起（探针日志 `C:/zizao-probe/run.log` 停在 `started photoshop=27.11.0`，必须 Ctrl+. 取消）；改用 Action Manager 建渐变填充图层后同样停在建图层那一步。既然一次都没有成功渲染，就不写 PS 的角度/中点实测结论。
- 已经能确认的 PS 侧事实：PS 27.11 能原生打开本项目的 PSD，图画渲染正确，图层面板按文件顺序列出 9 个像素层（`空心星魔杖`、`圆脸笑草`、`软糖星星`、`离线字造 Title`、`每一个字...得闪闪`、`糖纸小甜心`、`三重闪光`、`怦然爱心`、`软糖星星`），并用 `saveAs` 导出了 8301520B 的展平 PNG。ExtendScript 读取 `doc.layers[i]` 的属性会静默失败（`top-level layers=9` 之后一行都写不出来，且不抛错），所以图层树只以面板截图与 `ag-psd` 读回作证据，不冒充脚本读出的结果。

### 原生 Photoshop 27.11 核对逐元素 PSD（已做）

- 用 `C:/zizao-probe/sample.jsx`（只有 `app.open` + `duplicate`/`flatten`/`saveAs`，不碰任何渐变 API）打开 `verification/psd-1.4/sample.psd`：`opened sample.psd 500x430 layers=4`、`flattened=true bytes=647488`（日志 `verification/psd-1.4/ps-native/native-sample-log.txt`）。
- 图层面板（`verification/psd-1.4/ps-native/layers-panel-clean.jpg`，PS 原生，自上而下）：
  - `隐藏锁定路径` 组：**无眼睛图标＝隐藏**，已展开，含 `层 · 2`、`藏 · 1`；
  - `分色贴纸` 组：可见，已展开，含 `部件 · 4`、`部件 · 3`、`部件 · 2`、`部件 · 1`；
  - `多行旋转字形` 组：可见，已展开，含 `新 · 3`、`造 · 2`、`字 · 1`；
  - `图片保持单层`：单叶，可见。
  面板顺序与文件内「底→顶」写入一致（PS 面板反向显示），组名等于源图层名，子层名是「字符 · 序号」，图片层没有建组。
- 像素：`verification/psd-1.4/compare-native.mjs` 比较 PS 展平图与 `sample-reference.png`（白底，仅对不透明 native 有效）→ maxRGB `2.2549019607843377`，33803/215000 像素有差；同一张 PS 展平图与 PSD 自带的合并预览比 → maxRGB `3.015686274509818`，差的是同一批像素。也就是 PS 自己两条内部路径（展平 vs 读合并预览）差得比我们与它的差更多，残差属 PS 合成与色彩取整，不是叶层数据错位。
- 过程教训（写下来避免重犯）：第一次截的面板图有一行被悬浮提示挡住，我据此把 `多行旋转字形` 读成 2 子；把鼠标移开后重截才是 3 子。凡是面板计数，必须以无遮挡截图为准，并同时与 `ag-psd` 读回的数据模型对账。

### PSD 逐元素分层的效果语义

- 逐元素模式下每个叶子层用该元素自己的 `contentBounds` 和完整样式管线单独渲染，组透明度只在组上烘一次；锁定同时落在组和叶子层，隐藏组保持组隐藏、子层自身可见性不变，这样重新打开组还能恢复。
- 后果：重叠的投影/厚度/材质会按元素分别重算，逐元素合成与按图层合成可能不同。这是逐元素定义的直接结果，不是缺陷，UI 固定写这一句：『逐元素会分别重算重叠的投影、厚度和材质效果，合成外观可能与按图层不同。』
- PSD 内的合并预览必须等于叶层实际叠出的结果，否则 Photoshop 一展平就和预览不一致；因此不复用「按图层」的合成图。
- 两种模式的像素关系分开断言，不合并成一个宽容差：叶层叠加 vs 独立逐元素参考严格比较；效果边界不重叠的 fixture 上逐元素与按图层必须完全相同；有重叠的 fixture 上差异必须等于独立算出的逐元素差异（严格相等，不写区间）。

### 逐元素分层验收（实测数字，不是估计）

- `node --test tests/psd-elements.test.mjs` → `4 tests / 4 pass / 0 fail`；内部 17 个 fixture、54 个叶子层，逐个与该元素单独渲染的参考比：**alpha 差 0、预乘 RGB 差 0**。`npx tsc -p tsconfig.json --noEmit` exit 0。
- 同一工程两种模式真导两次（不是复用同一份中间结果）：`disjoint` fixture 上「elements 叠叶」vs「layers 模式 merged」= alpha 0、预乘 RGB `1.1843137254901999`、165 像素；两个模式各自写进 PSD 的 stored merged 之间 = alpha 0 / RGB 0 / 0 像素。`sample` = alpha 154 / RGB `154.99607843137255` / 29530 像素，`sample-crop` = alpha 131 / RGB `138.13333333333333` / 53398 像素 —— 这两个是逐元素定义下「重叠效果分别重算」的真实差值，与 UI 固定提示句一致，不是误差。
- 效果边界不重叠的 fixture 上要求严格相等：`gradient+depth+stroke` 非重叠 = alpha 0 / RGB 0 / 0 像素。唯一保留的非零量是 `gradient+shadow` 的 RGB 1 / 1040 像素：把父层 filter bbox 改回去也消不掉（1037/1050），判定为 Chromium 对 filtered SourceGraphic 的渐变量化，因此**按原值严格记录 `{maxAlpha:0,maxPremultiplied:1,differentPixels:1040}`**，没有写成 0，也没有放宽容差。
- 断言没有放松的证据：与冻结基线逐文件比，`tests/` 只多出 `gradient.test.mjs`、`psd-elements.test.mjs`，只有 `photoshop-port.test.mjs` 被改（assert 27 → 32 条），其余 16 个测试文件 assert 条数与基线完全相同（engine 87、letterforms 73、font-service 77、font-bundled 59、sticker-catalog 55、letterform-refresh 45、photoshop 36、style-catalog 35、engine-paint 26、logo 16、local-port 12、sticker-refresh 6、engine-paint-export 7）；`scripts/verify-psd.mjs` 与基线**逐字节相同**（39 条 assert 未动）。

## 历史：1.3.0 文件已发布并核验

用户要求的十款艺术字改进、完整离线、启动提速、新EXE与Photoshop包、一张零基础图文长PNG均已形成最终文件。发布目录为 [字造-1.3.0](../字造-1.3.0)，旧1.2与用户现有字造、Photoshop文档保持原状，没有Git提交或推送。

- 推荐 [字造-免安装.zip](../字造-1.3.0/字造-免安装.zip)：239423565B，SHA `f60eb2535530b4a3c843936a1ab10eab17ecbe3fb8da7da646bafb9767052309`。完整解压一次，再直接启动目录内程序。完整运行清单6316文件，SHA `af8c9130798b6bd8f1fb31cf10a6c301205955a7b13775efc64d6596af0ada53`。
- [Photoshop插件](../字造-1.3.0/字造-Photoshop插件.zip)：143248540B，SHA `b4190a88d36a424ee40e483cc79957c60b5a516d33de54b055995cae7ea6ebca`。实包Node/iframe/桥接/端口回退及8224个条目验证通过；原生CEP首次挂载未做，未安装或重启用户Photoshop。
- [长PNG说明书](../字造-1.3.0/字造-零基础图文说明书-长图.png)：1600×29680，24章、22张真实截图，6161432B，SHA `ec112fccdd548446f69a9688875d887fa00454b454aede2420ca7d27fbb695b7`。封面及全24章均实读，控制柄文案已修正。`node output/manual-1.3/finalize-manual.mjs` exit0，24章摘要匹配，visualReview=passed。
- [练习素材ZIP](../字造-1.3.0/字造-练习素材.zip)包含实际工程、透明标题和参考底图，解压内容逐字节匹配。目录同时有三份原文件、快速开始说明、校验清单和可选单文件程序。

最终测试：`npm test` exit0，99/99；`node tests/desktop.mjs --unpacked release/win-unpacked/字造.exe` exit0，31 checks、offline=true、fonts=1195、PNG=2013x626、errors=0；新字形真实UI37项；最终断网95项、产品外连0、浏览器错误0，Edge宿主53个背景请求被测试代理阻断。原生结果固定 [run-1793862212872](verification/desktop/run-1793862212872/results.json)。

同字节启动四轮全部成功：目录新配置3.679秒、再次1.465秒；单文件44.395秒、45.722秒。四轮导出透明PNG同SHA，全部正常退出。计时是隔离配置、隐藏窗口与调试连接下的编辑器可用时间，非OS冷缓存或视觉首帧。慢的主要原因是单文件每次本机全量解压，不是在线字体/模型；目录包避免重复解压。另修复随机本机受限端口导致的bad port错误。

[最终身份报告](verification/offline-components/linked-1793864243625/report.json)8项PASS，绑定包、完整目录、原生31项、断网95项、速度四轮及PS源码/静态字节。`node scripts/publish-release-1.3.mjs verification/offline-components/linked-1793864243625/report.json` exit0，status=verified。全部交付文件记录在 [发布清单](verification/release-1.3.0.json)。task24/28已complete，PS与手册审查结果全部收齐；仅保留原有网页服务bash-d76f11253801401b。

## 历史交接：1.3 最终验收 · 2026-11-05 15:05

目标 goal-1d3ccc94-1f46-4e4c-b01a-43ad4c77c767 revision9，active/armed。本轮仍交付：改进十款艺术字、本地离线、加快启动的免安装目录ZIP、Photoshop包、一张零基础图文长PNG。旧1.2保留，不关闭用户现有程序/未保存Photoshop，不提交或推送git。

- 艺术字主体/字腔/nonzero修复、原字形对照和预览已验证；旧1.1工程逐像素不变。真实UI专项37项/17截图、20次应用与撤销已通过，前端dist没有再改。当前dist：index-Cdiqnvf1.js、index-o56n1z49.css、psd-BYg2Us99.js、layer-actions-CuL8LAdo.js。
- 再次测速发现本机随机端口落入WHATWG限制端口，日志是 `TypeError: fetch failed` / `cause: Error: bad port`，不是在线下载。已新增共享listenLocal：自动49152–65535、最多128个候选，只重试EADDRINUSE/EACCES；固定端口保持单次；同步listen异常清理监听器。PS默认4200冲突也调用共享函数。`npm test` exit0：99 tests / 99 pass / 0 fail / 0 skipped，14893.6102ms。真实占用4200、两个字体worker、Edge iframe与同步异常清理均通过。
- 端口修复后桌面构建job bash-0bff025517774f47已collect exit0，release/win-unpacked/字造.exe与release/字造.exe为新候选。新原生31项job bash-d274c513cb45445e运行中；旧run-1793858204917的31PASS只证明修复前候选，不代替最终hash绑定。
- font-service已恢复task24/28，生成全新release/1.3-final/字造-免安装.zip，等PS valid receipt后做final offline。性能四轮必须等Lead单独发PERFORMANCE WINDOW READY，不与原生验收争抢资源。旧failed性能/诊断报告保留。
- Photoshop端口修复新候选build-1793861253676已存在，ZIP SHA b4190a88d36a424ee40e483cc79957c60b5a516d33de54b055995cae7ea6ebca；owner恢复验收，不重复打包。尚未确认valid。旧build-1793857338677的26PNG/52PSD等结果仅在相关JS指纹完全相同时明确引用；不安装或重启PS，新版原生CEP挂载仍未实测。
- `node output/manual-1.3/prepare-figures.mjs && node output/manual-1.3/build-manual.mjs` exit0：MANUAL FIGURES 22，编号无重叠；MANUAL RENDER 1600x29634 / chapters24 / actual-screenshots22 / broken-images0。长PNG已在独立1.3目录。Lead已经实际看完s1–s12，无裁切、箭头错指或操作事实缺陷；psd-export继续s13–s24并写final-visual-review.md。manual-report暂为rendered-needs-visual-review，不能提前标交付。实际练习JSON和透明PNG在output/manual-1.3，待复制到交付目录。

剩余：收取新包原生/PS/offline/速度的同字节证据；完成后半长图审查及封面/结尾；复制练习文件、核验发布hash并更新README/PACKAGING，present最终文件。只保留原有网页服务bash-d76f11253801401b，不重复历史工作。

## 历史过程：艺术字算法重做 + 零基础图文长PNG

用户追加要求：说明书要一张长PNG、图文并茂，不用PDF/Word替代；参考六张中文艺术字及新增中文花体字_哥特体_1000张.zip改进十款算法；所有组件离线运行；改善启动耗时。当前目标 goal-1d3ccc94-1f46-4e4c-b01a-43ad4c77c767 revision7，max20，active/armed。上一轮1.2已交付是历史，不替代本轮验收。无git提交/推送，不关闭用户现有字造或Photoshop，不操作未保存文档。

启动根因已由字体服务worker读到官方portable.nsi：每次启动删除旧解压目录、展开整包，之后才ExecWait Electron，退出再次清理；unpackDirName只控制路径。原1.2测得NSIS1.314s、Electron37.626s、ready40.582s，与该本地解包开销一致。task-28 font-service负责同字节首/次启动对照与最终测量；已决定用官方win-unpacked目录ZIP作为默认免安装入口，全部解压一次后直接启动目录内字造.exe，保留单文件portable可选。允许builder仅将executableName由Zizao改为字造和新增官方ZIP脚本；不写自制缓存、不装系统、不改用户草稿。尚未声称具体加速数据。

当前1.3产品代码已冻结：十款新算法改变字身粗细和笔端，单列96px预览提供原字形、纯轮廓/当前外观。原作者多次运行时中断后task23由Lead接手，独立letterform-check保留原15测试并添加6组真实字体回归。发现Noto字体同向重叠笔画被旧evenodd挖白缝，且containment误把同向内横画当字腔；新增Glyph.fillRule严格校验，新outline标记nonzero，engine和算法保留该规则，旧缺字段继续evenodd。真实相横笔修前3/22/21/22、修后3/4/3/3，原字体11/11/11/11；两张修后白底真图Lead已实读。`node --test tests/letterform-refresh.test.mjs`6PASS；原15PASS；`npm test`91PASS/0FAIL/0skipped（12652ms），真实旧1.1工程2013×624 PNG alpha/可见RGB差0。`npm run build`exit0，1672modules：index-Cdiqnvf1.js、index-o56n1z49.css、psd-BYg2Us99.js、layer-actions-CuL8LAdo.js。

1.3桌面构建job bash-21e2fb1ebd6b41f4已collect exit0，产出release/win-unpacked/字造.exe与release/字造.exe。Lead原生目录版31项验收job bash-eddfb1483e254e00运行中；task28做官方ZIP全文件验证，之后再测最终启动速度。PS新候选build-1793857338677打包成功，实际包验收运行中，尚未宣布valid；旧1.2不覆盖。task25真实UI验收首轮选中边框在150ms过渡中读到rgb17，目标仍严格rgb0，仅加有界终态等待后重跑，产品未变。

手册output/manual-1.3/capture.mjs与build-manual.mjs已准备，单张1600px宽、24章、真实编号箭头，未替换为PDF/Word。第一次截图被错误的「简体中文+Huninn」筛选阻塞：manifest只广告zh-Hant/en，改教程和截图为「中文字体」后重跑job bash-dd2c7c694e064d50。六原图二次审查、ZIP20原样本与14二次样本锚定已完成；非全1000张逐图审查。长PNG尚待采集完成、渲染与逐段读图。

计划：参考锚定 → 真实字身/笔端算法 → 清楚的纯轮廓/当前外观预览 → 断网回归和新版EXE/PS包 → 真实新版截图与带编号箭头的一张长PNG。软件内部升级为1.3.0，外部主文件名仍为字造.exe；新版交付到独立版本目录，旧1.2文件保持不变。长图使用本地绘制、嵌入截图，无外部字体/CDN/在线资源。

并行scope：task-23 原calligraphy多次运行时中断，现已移交letterforms（revision3）；沿用已落盘180行letterform-geometry.ts、原15项PASS baseline及88件基线图，继续集成，不重做基线。独占src/letterforms.ts、src/letterform-geometry.ts、字形测试和verification/letterform-refresh。六参考图已经Lead第二遍重新打开校验，style-anchor.md/style-lock.txt已落盘。要求强度0.65即可明显，实际主体非仿射粗细/笔端变化，保留字腔/paint深复制/原十ID/还原/多行/旋转；先发书法+哥特两款大图审查。task-25 bundled-fonts 独占src/LetterformControls.tsx与src/workbench.css及verification/letterform-ui，改宽卡/原字形对照/纯轮廓预览，切换不改工程，等Lead统一构建后真实1440/390检查。task-24 font-service 只写tests/offline-components.mjs与verification/offline-components，审计本地依赖并准备外网封锁，等FINAL OFFLINE BUILD READY再验新版；不重复原生可见窗口监控。

手册事实核对agent 0ca91964-120e-49ee-84e2-2acfa137c0ec 仅写output/manual-1.2/evidence/ui-facts.md，agent 1519b3b0-e477-4169-8896-ad342f6ab616 仅写setup-faq.md；动态agent可收到事件但send_message以该id返回active teammate not found，不再重试。当前重要纠正：顶部是逐字排版；整层拖动先图层列表选中再选择与移动；没有图层重命名/拖拽排序入口。Delete/Backspace删整层、节点操作用右侧按钮；勾选图层用于合并，不是多选拖动。改内容/字体/字号/字距/行距/横竖排会重建单字，先做文字设置再逐字摆。拉平只清Y/角度，不还原X且会合并多行Y。数字/HEX按Enter或离焦提交；只有内外描边滑条onPreview实时画，其他滑条松手提交。PNG所选图层会强制包含所选隐藏层，但PSD/SVG仍按全工程；PNG模式不控制PSD/SVG。自动保存启动API失败保旧稿不等于损坏JSON必可恢复。正式保存下载新.zizao.json，不是回写原文件，默认Downloads目录。插件安装无开发模式确认弹窗，debugmode缺失时脚本直接报错；PS1.2未原生挂载，不照抄README历史27.11泛句。

六图：0e8504…（美好生活/春暖花开：细横粗竖与笔端回旋）、10c942…（银河铁道：重斜身/长撇捺/大负形）、f1d2f8…（杨桂：流线粗细与连续收笔）、685629…（别世界：极细横/粗竖/内凹尖衬线）、2ed84f…（月相明暗：瘦高骨架/切角锋口）、480daf…（雷鸣八卦：宽骨架/内凹弧尖端/硬朗锋芒）。不复制水印/背景闪电或整字标，不将其配色误当算法。

## 1.2 已交付 · 2026-11-05

本轮用户要求已进入最终文件：修复字体搜索，按参考重绘400个分色装饰，依实际 Figma 规范重构工作台，增加启动反馈与模糊加载/重试，主文件名为字造，采用用户提供的透明 Tt Logo，并提供内外描边宽度滑条。旧版文件、用户现有字造/Photoshop 进程和文档保留。未做 git commit/push。

### 当前交付文件

- [字造.exe](../字造.exe)，1.2.0，166735129字节，SHA-256 `8b6b196c4052b6c378c3d15b3c71bd8f3612894d8ae93fe1f445174595a09f1d`。
- [字造-Photoshop插件.zip](../字造-Photoshop插件.zip)，1.2.0，143243776字节，SHA-256 `37e50a0fcd429111599eb237d9587189ab45d4091a2151865b1f20cc38b33707`。

`node scripts/publish-exe.mjs && node scripts/publish-photoshop.mjs` exit 0。以不覆盖方式复制，源文件与最终文件摘要一致。先保存并退出旧版字造窗口，再打开新版，避免旧进程的单实例锁继续聚焦旧窗口。配置继续使用 `%APPDATA%/ZizaoStudio`。

### 验证结果

- `npm run build` exit 0，Vite6.4.5、1671modules。最终资源为 `index-DfUotBwL.js`、`index-L-mDitoL.css`、`psd-D1tiFWlF.js`、`layer-actions-BEMdmBqK.js`。
- `npm test` exit 0：85tests、85pass、0fail、0skipped。覆盖分色、字形、字体、图层/PSD/PNG/ZIP、Logo、旧轮廓和当前400素材真渲染。
- `node tests/search-refresh.mjs` exit 0：28checks、errors=0。
- `node tests/upgrade.mjs` exit 0：9组、69checks，包含内外描边按住拖动时SVG更新、松手一次提交、一次撤销完整还原。
- `node verification/figma-ui/check-workbench.mjs` exit 0：16checks、22screenshots。
- `node verification/figma-ui/check-startup-integrity.mjs` exit 0：7checks、6screenshots、pageErrors=0。
- `node verification/figma-ui/check-final-logo.mjs` exit 0：10checks、7screenshots、errors=0。
- `node tests/portable-startup.mjs --final-exe-ready --exe F:/dnowload/封面/title-studio/release/字造.exe --version 1.2.0` exit 0：36PASS。原始报告和新原生阶段图保留在[启动验收目录](verification/portable-startup/run-1793850927805)。
- `node tests/desktop.mjs release/字造.exe` exit 0：`DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0`。全新隔离目录、仅一份EXE、无系统Node/外网/开发服务，完整重启通过。

最终原生输出为PNG824071字节、PSD2117769字节、逐层PNG ZIP972735字节、工程201418字节。回执路径、磁盘大小、解码图层次序/共同尺寸全部通过。PNG有813049个全透明像素、349896个可见像素。见[完整离线结果](verification/desktop/run-1793851072202/results.json)。

### 本轮关键修正

字体检索统一NFKC、大小写及多空白关键词；当前使用字体与筛选结果分开，无结果禁用选择并可恢复。搜索/清除不写工程历史。真实画面确认只有外层焦点环、清除后焦点保留，手机不溢出。

启动失败时保持loading，停止自动保存及快捷键，提供重试。67150字节六层真实工程在加载/API503和Ctrl+S/D/Delete后逐字节不变。静态手机加载卡原宽360、右边仅6px；给overlay显式 `grid-template-columns:minmax(0,1fr)` 后，390px画面卡片x24/width342/right366，原严格断言通过。

NSIS首次窗口观察为t+1.314s，BMP截图t+1.409s且RMSE=0；Electron窗口观察37.626s，实际原生加载图38.712s、就绪图40.912s，同HWND5513008。dom-ready的37.756s不是精确首绘。带监视器、冷profile及完整解压仍约40s，这次验证早期可见反馈，不宣称整体启动加速。Lead已实读原生loading、ready和最终工作台图。

用户Logo主图200×200，6157个全透明像素，RGBA SHA-256 `c5d8085ddfba307328b69517379e4539891efce2aa3eaefe1446ed6954f4482a`；原图与主图逐像素差0。主图/加载页/七档ICO/BMP/favicon/Photoshop头部均引用相同图像来源。换图后五份HTML/JS/CSS与完整功能回归时摘要一致，另补实际资源加载和图片截图验证。

400个装饰保持原ID，全部分色和可编辑。月环蝙蝠原本把环孔重绘成实心面，新增测试先1FAIL，再在preserveHole添加对应分支，原测试1PASS。最终几何/像素各400唯一，400节点改动在固定原视口中均改变真实alpha/预乘RGB，外剪影实测374。旧388唯一剪影与14个旧索引细节仍通过真实stickerGeometry测试。见[质量报告](verification/decoration-refresh/quality/report.json)。

字形变换曾丢paint，且原图/备份共享paint引用。新增两项失败回归后，cloneGlyph独立复制paint/commands，正文和空白路径都保留分色。15项字形测试及独立11项复验通过，覆盖全部十款预设、0/.65/1强度及恢复。旧1.1真实六层三十glyph工程以crop=true、padding36、scale1重导出2013×624，alpha和可见RGB差0。见[旧工程报告](verification/paint-review/legacy-compatibility-report.json)。

### Photoshop 验证边界

新包运行时11、桥接11、实包编辑器12、Logo6、发布8项检查通过，8224个ZIP条目由独立.NET解码器核对大小与摘要。来自同一冻结源码的Chrome99目标单独构建，实测浏览器为Edge156。未覆盖已安装1.1插件、未操作或重启Photoshop。原生CEP首次挂载和新版宿主交互仍待用户保存文档、安装并重启后验证；历史1.1原生24状态/10组像素结果不算作本轮实测。

详见[交付记录](PACKAGING.md)和[新版插件验收报告](verification/photoshop/release/build-1793850633741/verification/FINAL-VERIFICATION.md)。全部必需队友结果及后台任务已收取；仅原先保留的网页服务另行存在。所有文件工具继续使用绝对路径，OPS相对路径曾误落HARNESS。

## 历史：1.1 已交付

2026-11-05：69项模块测试、9组69项真实浏览器检查通过；实际Photoshop27.11原生导入24项状态和10组全像素比较通过。用户未保存文档保留，CEP首次面板挂载当时未重启验证。

[1.1 EXE](../字造-1.1.0-离线版-x64.exe)为166690102字节、SHA-256 `6bf81e4049d1ad9fddff9da79f5a8fd37c204af687315219b83ef38c266b0e4f`；[1.1插件](../字造-1.1.0-Photoshop插件.zip)为143201212字节、SHA-256 `b99f2e44dfb2203688e55bd1fae458f14349bd83a1fda9911d0db5ddc10284dd`。原生31项通过，PNG2013×624。旧文件均保留。

## 历史：原生下载验收排查

首轮字形面板懒加载点击后立即计数产生 `0 !== 5`，等待真实可见后原数量与几何断言通过。其后PSD回执completed却出现 `ENOENT: no such file or directory, stat 'F:\\dnowload\\封面\\title-studio\\verification\\desktop\\offline-title.psd'`；另一轮received839996却读到旧960145字节，断言 `960145 !== 839996`。

共同错误假设是CDP连接只观察、不改变下载配置。独立探针使用全新目录，EXE主进程和验收进程同时读取不到目标，排除了中文映射和进程读取差异。Playwright1.64.1默认通过Browser.setDownloadBehavior的allowAndName把下载转到临时GUID目录。仅测试驱动connectOverCDP增加公开 `{ noDefaults: true }`，保留应用原生保存路径；产品字节保持不变。

同探针对照与完整重启验收随后通过。测试每轮使用全新目录，严格比较回执保存路径、接收字节和实际磁盘字节，避免旧文件伪通过。历史证据保留在[1.1离线验收目录](verification/desktop/run-1793842397834)。
