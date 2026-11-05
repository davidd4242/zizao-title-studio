# 字造 1.5.0 交付记录

本版放在独立的 [字造-1.5.0 目录](../字造-1.5.0)，旧版保留。复制采用不覆盖方式，源文件与交付文件的 SHA-256 一致。完整清单见 [release-1.5.0.json](verification/release-1.5.0.json) 与 [SHA256SUMS.txt](../字造-1.5.0/SHA256SUMS.txt)。

| 交付文件 | 字节 | SHA-256 |
| --- | --- | --- |
| [字造-1.5.0-完整安装版.exe](../字造-1.5.0/字造-1.5.0-完整安装版.exe) | 343193143 | `7be3a18766a65c3119f8df5f5585129969b00d4372cdf12440ad3314d33fb172` |
| [字造-Photoshop插件-安装版-1.5.0.exe](../字造-1.5.0/字造-Photoshop插件-安装版-1.5.0.exe) | 87935788 | `189dc6085c076cd2cef3026bc0a89032a4973eff21e04d107e5c1995dacd3166` |
| [字造-免安装.zip](../字造-1.5.0/字造-免安装.zip) | 249085674 | `bf619fcada7e614e490134c8ab0bf434ae7fd783c4aa527cad351061eb7e9532` |
| [字造-Photoshop插件.zip](../字造-1.5.0/字造-Photoshop插件.zip) | 141763166 | `c580fb87362bef24eec39435c20f022e0b8d4d8449d8d7385f42d95a3f1d7195` |
| [零基础图文长PNG](../字造-1.5.0/字造-零基础图文说明书-长图.png) | 8037403 | `6d99d062eb24223836aa53f51ae18badac1159137ef1463c0af79236acb64fbb` |
| [字造-练习素材.zip](../字造-1.5.0/字造-练习素材.zip) | 625684 | `700240e838e8bcd80de47e7413d641af60df02abb5005f01a7a27e7a7eb3c9cc` |
| [先看这里.txt](../字造-1.5.0/先看这里.txt) | 2877 | `61fe52677c349f4151bd3f509eedd4ade5cab24499f6d7fb5af7f2c09fdc9fc3` |
| [可选单文件程序](../字造-1.5.0/可选单文件/字造.exe) | 166703907 | `e43cf3e7a57a060e61e431dc6863dfd629b304a500f1f911e75fffa338b3f835` |
| [SHA256SUMS.txt](../字造-1.5.0/SHA256SUMS.txt) | 1084 | `1d2d25bb87f7a19716e2ff240cc0cc3f9a7de21c8f80d121cb366201a9c32cd7` |
| [manifest.json](../字造-1.5.0/manifest.json) | 2831 | `45a600c1f4ce2de89b591f8c02f361385ba0873aa43694d5d0e978296a5e1dec` |

安装实测（隔离目录，未触碰正式安装）：`install-smoke.ps1` → `exit=0`、`rootFiles=17`、`desktopShortcuts=3`、四个附加文件齐全（长图 8037403、插件 141762773、练习素材 625684、先看这里 2877）；`node scripts/verify-installed.mjs` → `APP 6316/6316 byte-identical` 且四个 EXTRA 全部 `match=true`、`INSTALLED VERIFIED`；随后 `uninstall-smoke.ps1` → `uninstallExit=0`、`installDirExists=False`、快捷方式与卸载登记全部消失。证据在 `verification/installer-1.5.0/`。安装包未签名，Windows 会给出常规 SmartScreen 提示。

本轮源码冻结后重跑的完整链路：

- `npm run build`：exit 0，`built in 2.42s`；`dist/assets/index-BQ-4wtgH.js` 364.44 kB、`index-FMrRHxeS.js` 525.20 kB。
- `npx electron-builder --config desktop/builder.cjs --win portable --x64`：exit 0，`release/win-unpacked` 6316 文件 513107681 B，`release/字造.exe` 166703907 B。
- `node tests/desktop.mjs --unpacked release/win-unpacked/字造.exe`：`DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0`。
- `npx electron-builder --config desktop/builder-installer.cjs --win nsis --x64 --prepackaged release/win-unpacked`：exit 0，产出 `release/字造-1.5.0-完整安装版.exe` 343192557 B。
- `node scripts/verify-installer.mjs`：`APP files 6316/6316 byte-identical`、`INSTALLER VERIFIED`。
- `node scripts/package-startup.mjs --final-startup-build-ready --input release/win-unpacked --version 1.5.0 --output release/1.5-final/字造-免安装.zip`：5 PASS，`{"ok":true,"checks":5}`；源目录 6316 文件 513107681 B `fa76b49b…`。
- `node scripts/package-photoshop.mjs`：exit 0，`Zizao-Photoshop-1.5.0.zip` 141762773 B `a71cf3e1…`（本地头写 CRC/尺寸，无 data descriptor）。
- `node scripts/package-plugin-installer.mjs --bundle <解压后的 Zizao-Photoshop-1.5.0>`：用 NSIS 3.04 编译 `release/字造-Photoshop插件-安装版-1.5.0.exe`；`desktop/plugin-installer.nsi` 必须存成 UTF-8 **带 BOM**，否则 makensis 报 `Bad text encoding ... on line 1`。
- `node output/manual-1.5/finalize-manual.mjs`：`MANUAL VERIFIED: 1600x32629; chapters=27; screenshots=26; sectionHashes=27; visualReview=passed`。
- `node scripts/publish-release-1.5.mjs`：全部复制后摘要匹配，写出 `SHA256SUMS.txt`、`先看这里.txt` 与 `verification/release-1.5.0.json`；`sha256sum -c SHA256SUMS.txt` 10 项 OK。

安装顺序上有一处硬约束：`desktop/installer.nsh` 用 `File` 直接引用交付目录 `F:/dnowload/封面/字造-1.5.0/` 下的长图、练习素材、插件 ZIP 和 `先看这里.txt`，所以必须先跑 `node scripts/publish-release-1.5.mjs --pre-installer` 把这些文件放好，再构建 NSIS，否则安装包会缺文件。

---

# 历史：字造 1.4.0 交付记录

本版放在独立的 [字造-1.4.0 目录](../字造-1.4.0)，旧版保留。复制采用不覆盖方式，源文件与交付文件的 SHA-256 一致。完整清单见 [release-1.4.0.json](verification/release-1.4.0.json) 与 [SHA256SUMS.txt](../字造-1.4.0/SHA256SUMS.txt)。

| 交付文件 | 字节 | SHA-256 |
| --- | --- | --- |
| [字造-1.4.0-完整安装版.exe](../字造-1.4.0/字造-1.4.0-完整安装版.exe) | 344291144 | `7ff62a164d055a4ef7eaafd93629275831c1019f1aa5cfc0eedd2eb054e44ba5` |
| [字造-免安装.zip](../字造-1.4.0/字造-免安装.zip) | 239429579 | `46c34bcd497a40c51b90b26b25d98c0a2a4bdcddbc54fe3647c6a5342bfb3592` |
| [字造-Photoshop插件.zip](../字造-1.4.0/字造-Photoshop插件.zip) | 143255521 | `b8af2a14a29b7f337665472614c8a4741c813204660986c1ab44c679b7153162` |
| [零基础图文长PNG](../字造-1.4.0/字造-零基础图文说明书-长图.png) | 7765948 | `a118fa197a21809845af61ba3424fae83a3cbc433dfffda5d9f1c7f8dc4b6264` |
| [练习素材.zip](../字造-1.4.0/字造-练习素材.zip) | 625687 | `2c2dc85dee4c0880496256b53ec7e8b5d9b1af654c2f408116645d41eb4ab14d` |
| [先看这里.txt](../字造-1.4.0/先看这里.txt) | 1890 | `195364619496af978b27347733561c4a650826adf375a428672f80b1a611b4d6` |
| [可选单文件程序](../字造-1.4.0/可选单文件/字造.exe) | 166714039 | `fef4366e56328c668431ecd47aa5b3237cadc1ef6270abb5855d26c1e3d05aaa` |
| [SHA256SUMS.txt](../字造-1.4.0/SHA256SUMS.txt) | 975 | `68ea6c17b40bb5a5a1666f545d66ff0fd1ced7fdfe29765b7131a78d78785fd7` |
| [manifest.json](../字造-1.4.0/manifest.json) | 2606 | `7ecc89f22d78cb9b950667e1c5e05596f0438cac63676a03cee9c117fe87d30c` |

安装实测（隔离目录，未触碰正式安装）：`install-smoke.ps1` → `exit=0`、`rootFiles=17`、`desktopShortcuts=3`、四个附加文件齐全；`node scripts/verify-installed.mjs` → `APP 6316/6316 byte-identical` 且四个 EXTRA 全部 `match=true`、`INSTALLED VERIFIED`；随后 `uninstall-smoke.ps1` → `uninstallExit=0`、`installDirExists=False`、快捷方式与卸载登记全部消失。证据在 `verification/installer-1.4.0/`。安装包未签名，Windows 会给出常规 SmartScreen 提示。

本轮源码冻结后重跑的完整链路：

- `npm run build`：exit 0，`built in 2.41s`；dist 整体指纹 `38c82622230fcff70a82edab7d0003bc4d5ea28934593330c5ca6eee96577e2d`。
- `npx electron-builder --config desktop/builder.cjs --win portable --x64`：exit 0，`release/win-unpacked` 6316 文件 513103288 B。
- `node tests/desktop.mjs --unpacked release/win-unpacked/字造.exe`：`31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0`。
- `npx electron-builder --config desktop/builder-installer.cjs --win nsis --x64 --prepackaged release/win-unpacked`：exit 0，产出 `release/字造-1.4.0-完整安装版.exe`。
- `node scripts/verify-installer.mjs`：`APP files 6316/6316 byte-identical`、`INSTALLER VERIFIED`。
- `node scripts/package-startup.mjs --final-startup-build-ready --input release/win-unpacked --version 1.4.0 --output release/1.4-final/字造-免安装.zip`：5 PASS，`{"ok":true,"checks":5}`。
- `node output/manual-1.4/finalize-manual.mjs`：`MANUAL VERIFIED: 1600x32736; chapters=27; screenshots=26; sectionHashes=27; visualReview=passed`。
- `node scripts/publish-release-1.4.mjs`：全部复制后摘要匹配，写出 `SHA256SUMS.txt`、`先看这里.txt` 与 `verification/release-1.4.0.json`。

安装顺序上有一处硬约束：`desktop/installer.nsh` 用 `File` 直接引用交付目录 `F:/dnowload/封面/字造-1.4.0/` 下的长图、练习素材、插件 ZIP 和 `先看这里.txt`，所以必须先跑 `node scripts/publish-release-1.4.mjs --pre-installer` 把这些文件放好，再构建 NSIS，否则安装包会缺文件。

---

# 历史：字造 1.3.0 交付记录


## 当前文件

本版放在独立的 [字造-1.3.0 目录](../字造-1.3.0)，旧版保留。复制采用不覆盖方式，源文件与交付文件的 SHA-256 一致。完整清单见 [release-1.3.0.json](verification/release-1.3.0.json) 与 [SHA256SUMS.txt](../字造-1.3.0/SHA256SUMS.txt)。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [字造-免安装.zip](../字造-1.3.0/字造-免安装.zip) | 239423565 | `f60eb2535530b4a3c843936a1ab10eab17ecbe3fb8da7da646bafb9767052309` |
| [字造-1.3.0-完整安装版.exe](../字造-1.3.0/字造-1.3.0-完整安装版.exe) | 342608231 | `b84663645229321f151e8a9caaf6e70897ea631dafa43f35e38aa34479b7ff33` |
| [字造-Photoshop插件.zip](../字造-1.3.0/字造-Photoshop插件.zip) | 143248540 | `b4190a88d36a424ee40e483cc79957c60b5a516d33de54b055995cae7ea6ebca` |
| [零基础图文长PNG](../字造-1.3.0/字造-零基础图文说明书-长图.png) | 6161432 | `ec112fccdd548446f69a9688875d887fa00454b454aede2420ca7d27fbb695b7` |
| [练习素材.zip](../字造-1.3.0/字造-练习素材.zip) | 527748 | `28dc4686a56bd94d3917ed46c57eab0c15dc2e4484b7e0e28f46b5e6ea724172` |
| [可选单文件程序](../字造-1.3.0/可选单文件/字造.exe) | 166708113 | `520e563bf2a3e4a69cb8afbd2bd2a9bc549af5a37aa039b96bade4f82c2f8b30` |

日常使用免安装 ZIP。全部解压后，保留整个文件夹，双击其中的程序；需要桌面入口时创建快捷方式。更新前先保存工程并退出旧版本，配置仍为 `%APPDATA%/ZizaoStudio`。本轮未关闭用户现有程序和 Photoshop 文档，未覆盖正在使用的插件。

## 单一安装包

按用户要求把全部内容装进一个 EXE：主程序、图文长图、练习素材、Photoshop 插件和说明文件。安装器由 `desktop/builder-installer.cjs` 描述、`desktop/installer.nsh` 写入随包资料，使用 `--prepackaged release/win-unpacked`，因此装进去的程序与已验收的冻结目录逐字节相同（6316 个文件全部一致）。安装为当前用户、可选目录，生成桌面“字造”快捷方式，以及说明书和练习素材两个入口；卸载会同时清掉快捷方式和卸载登记。安装后直接读本地文件，不再每次解压。

实测（隔离临时目录，未触碰正式安装）：静默安装 exit 0，17 个根文件 + `使用说明` 4 个文件；`node scripts/verify-installed.mjs` → `APP 6316/6316 byte-identical; INSTALLED VERIFIED`；随后静默卸载 exit 0，安装目录、3 个桌面快捷方式和卸载登记全部消失。证据在 `verification/installer-1.3.0/`。安装包未签名，Windows 会给出常规 SmartScreen 提示。

## 启动速度与离线结果

单文件便携包每次启动都会完整解压，退出后清理解压目录。新版默认目录包解压一次后直接读取本地文件，省去该等待。四轮测量使用相同的6316个运行文件，均成功加载字体、导出相同的透明PNG并正常退出。

| 方式 | 新配置启动到编辑器可用 | 再次启动到编辑器可用 |
| --- | ---: | ---: |
| 免安装目录包 | 3.679秒 | 1.465秒 |
| 单文件便携包 | 44.395秒 | 45.722秒 |

这是本机隔离配置、隐藏窗口及调试连接条件下的四次观察；新配置不等于系统冷缓存，时间也不是视觉首帧。见 [完整测速报告](verification/startup-speed/final-1793863065048/report.json)。

最终断网验收95项通过。实际编辑器、Photoshop实包Node与字体Worker均由测试封锁外部网络；字体、十款字形、200款风格、400个装饰、PNG/SVG/PSD/ZIP与工程往返均通过，产品外连尝试为0、页面错误为0。Edge宿主53个后台请求由测试代理阻断并单独记录。见 [断网报告](verification/offline-components/final-1793864125377/report.json)。

随机本机服务端口曾触发 Node `Error: bad port`。共享监听函数现选49152–65535高位端口，处理占用重试；Photoshop默认4200冲突时也使用该函数。固定端口语义和来源检查保留。此问题与字体或模型在线下载无关。

## 实际验收命令

下列命令均退出0。未因文档更新重复执行产品测试。

- `npm test`：99 tests / 99 pass / 0 fail / 0 skipped。
- `node tests/desktop.mjs --unpacked release/win-unpacked/字造.exe`：`DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0`。完整重启、字体持久化、原生PNG/PSD/ZIP/工程下载均验证。
- `node verification/letterform-ui/check-letterform-ui.mjs`：37 checks / 17 screenshots / 30 renders / errors=0。
- `node scripts/package-startup.mjs --final-startup-build-ready --input release/win-unpacked --version 1.3.0 --output release/1.3-final/字造-免安装.zip`：5 PASS；源目录、ZIP与实际解压目录逐文件大小和SHA一致。
- `node tests/startup-speed.mjs --final --final-startup-build-ready --unpacked verification/startup-speed/package-1793862279520/字造-免安装 --portable release/字造.exe --version 1.3.0 --executable-name 字造.exe`：7 PASS / 4 rounds。
- `node tests/offline-components.mjs --final --final-offline-build-ready --ps-record verification/photoshop/release/build-1793861253676/release.json --exe release/字造.exe --version 1.3.0`：95 PASS。
- `node verification/offline-components/link-final-evidence.mjs --offline verification/offline-components/final-1793864125377/report.json --package verification/startup-speed/package-1793862279520/report.json --native verification/desktop/run-1793862212872/results.json --speed verification/startup-speed/final-1793863065048/report.json --version 1.3.0`：8 PASS。
- `node output/manual-1.3/finalize-manual.mjs`：`MANUAL VERIFIED: 1600x29680; chapters=24; screenshots=22; sectionHashes=24; visualReview=passed`。
- `node scripts/publish-release-1.3.mjs verification/offline-components/linked-1793864243625/report.json`：`status: verified`，复制后全部摘要匹配。

[身份绑定报告](verification/offline-components/linked-1793864243625/report.json)把目录ZIP、原生31项、速度四轮、断网报告和Photoshop冻结包连到实际同一组文件。目录包完整清单SHA为 `af8c9130798b6bd8f1fb31cf10a6c301205955a7b13775efc64d6596af0ada53`。单文件程序的证据为四轮中的启动、字体、透明PNG和运行文件身份；原生完整31项针对推荐目录包。

## 艺术字、手册与Photoshop边界

十款字形改进主体笔画粗细、笔端和少量首尾延伸；新生成字体采用正确的nonzero填充规则，避免同向重叠笔画被挖出白缝。无新字段的旧工程保持原有渲染。原15项和新6组字形回归通过；真实旧工程PNG的alpha及可见像素差为0。

长说明书是一张1600×29680 PNG，24章、22张真实界面截图和编号箭头。Lead查看封面及1–12章，独立审查查看13–24章；第19章控制柄识别文案修正后重新查看19–24章，其余章节指纹未变。[手册验收](output/manual-1.3/manual-report.json)记录24章指纹及[最终逐章审查](output/manual-1.3/evidence/final-visual-review.md)。练习ZIP包含实际保存的工程、透明标题PNG和参考底图。

Photoshop最终包的运行时11、桥接11、端口冲突回退10、发布8项通过；独立.NET逐项核对8224个ZIP条目。前端字节与上一候选完全一致，历史26PNG/52PSD结果按哈希明确复用，不计为本轮重跑。当前没有安装或重启用户Photoshop，新版原生CEP首次挂载仍未验证；实际自动化覆盖实包Node、Edge iframe和MessageChannel。见 [最终插件报告](verification/photoshop/release/build-1793861253676/verification/FINAL-VERIFICATION.md)。

---

# 历史：字造 1.2.0 交付记录

## 当前交付文件

- [字造.exe](../字造.exe)：166,735,129 字节；SHA-256 `8b6b196c4052b6c378c3d15b3c71bd8f3612894d8ae93fe1f445174595a09f1d`。
- [字造-Photoshop插件.zip](../字造-Photoshop插件.zip)：143,243,776 字节；SHA-256 `37e50a0fcd429111599eb237d9587189ab45d4091a2151865b1f20cc38b33707`。

`node scripts/publish-exe.mjs && node scripts/publish-photoshop.mjs` exit 0。两份文件均以不覆盖方式复制，复制后流式 SHA-256 与验收源文件相同。1.0/1.1 文件保留，当前用户程序和 Photoshop 文档未关闭。

升级时先保存并退出旧版字造窗口，再打开上面的新 EXE。程序继续使用原有 `%APPDATA%/ZizaoStudio` 配置和工程缓存。运行中的旧版进程保持原状，不会因为复制新 EXE 自动替换。

## 本轮改动

用户提供的透明 Tt Logo 已用于工作台、静态加载页、React 加载卡、原生窗口图标、启动 BMP、favicon 和 Photoshop 面板。主图保持原始 200×200 RGBA，保留 6,157 个全透明像素，逐像素差为 0。

“贴纸描边”保留数值框，并分别提供内、外描边滑条。范围为内边 0–40、外边 0–70，步进 0.5。真实鼠标拖动在按住时更新 SVG；中途不写历史，松手提交一次，撤销完整还原。见[实际滑条截图](verification/upgrade/glyph-stroke.png)和[鼠标回归代码](tests/upgrade.mjs#L213-L234)。

工作台采用实际下载的 Figma 设计规范。字体、风格和装饰共享搜索焦点/清除行为；字体检索支持全角归一化、多空白关键词和无结果恢复。400 个装饰保持原 ID，新增独立分色、整体包边和厚度；原无 paint 工程继续走原渲染分支。

## 实际验收

以下命令均已运行并退出 0：

- `npm run build`：Vite 6.4.5，1,671 modules。
- `npm test`：85 tests、85 pass、0 fail、0 skipped。
- `node tests/search-refresh.mjs`：28 checks、errors=0。
- `node tests/upgrade.mjs`：9 组、69 checks，包含内外滑条真实鼠标预览和单次撤销。
- `node verification/figma-ui/check-workbench.mjs`：16 checks、22 screenshots。
- `node verification/figma-ui/check-startup-integrity.mjs`：7 checks、6 screenshots、pageErrors=0。真实保存工程在加载/API 503及快捷键操作中逐字节不变。
- `node verification/figma-ui/check-final-logo.mjs`：10 checks、7 screenshots、errors=0。换 Logo 后的五个 HTML/JS/CSS 文件与完整功能回归时逐字节摘要一致；另实测图片资源，不把旧图作为新图证据。
- `node tests/portable-startup.mjs --final-exe-ready --exe F:/dnowload/封面/title-studio/release/字造.exe --version 1.2.0`：36 checks，PASS，errors=[]。
- `node tests/desktop.mjs release/字造.exe`：实际输出如下。

```text
DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x626; errors=0
```

完整 EXE 验收把单个 EXE 放入中文与空格目录，隔离配置、移除系统 Node 路径、屏蔽外网和开发服务，再完整重启。55 款内置字体的完整字节、摘要、许可证及简/繁/英轮廓通过验证。原生下载回执、实际路径与文件大小严格一致：PNG 824,071 字节、PSD 2,117,769 字节、逐层 PNG ZIP 972,735 字节、工程 201,418 字节。PNG 含 813,049 个全透明像素和 349,896 个可见像素。详见[本轮离线结果](verification/desktop/run-1793851072202/results.json)及[实际工作台](verification/desktop/run-1793851072202/desktop-offline.png)。

真实 NSIS 启动观察首次捕获反馈约为 1.314 秒，随后同一个 Electron 窗口显示模糊工作台和加载文字，再恢复清晰工作台。启动 BMP 像素 RMSE=0；原生 loading/ready 帧均已读回。dom-ready 回调时间和异步截图时间分别记录，不作为精确首绘时刻。详见[原始启动报告](verification/portable-startup/run-1793850927805/report.json)、[原生加载帧](verification/portable-startup/run-1793850927805/native/native-5513008-010.png)和[原生就绪帧](verification/portable-startup/run-1793850927805/native/native-5513008-034.png)。

当前 400 个装饰的完整几何和实际渲染像素各有 400 个唯一结果，400 个节点实改和深拷贝检查通过；外剪影实测为 374 种，不声称全部外剪影不同。保留真实旧轮廓的 388 个唯一剪影和旧细节回归。旧 1.1 原生工程重导出 2013×624，与原 PNG 的 alpha 和可见 RGB 差均为 0。见[装饰质量报告](verification/decoration-refresh/quality/report.json)及[旧工程逐像素对比](verification/paint-review/legacy-compatibility-report.json)。

## Photoshop 本轮验证边界

新包包含 8,218 个扩展文件、8,224 个唯一 ZIP 条目、55 款完整字体及许可证、Node v25.2.1 和 19 个生产依赖。独立 .NET 解码器逐项核对 ZIP 大小和 SHA-256，全部相同。运行时 11、桥接 11、实包编辑器 12、Logo 6、发布 8 项检查全部通过。

主编辑器和 Chrome 99 目标插件分别从同一份冻结源码构建，不要求两份 dist 字节相同。实包浏览器测试为 Edge 156；本轮未在真实 CEP Chromium 99 面板首次挂载，也未覆盖用户正在用的 1.1 插件。用户保存 Photoshop 文档、安装新包并重启后，仍需验证菜单“字造”、首次挂载和新版宿主交互。1.1 的原生导入像素结果仅保留为历史，不写作本轮实测。详见[1.2 Photoshop 完整报告](verification/photoshop/release/build-1793850633741/verification/FINAL-VERIFICATION.md)。

---

# 历史：字造 1.1.0 离线交付记录

## 交付文件

- [Windows x64 离线 EXE](../字造-1.1.0-离线版-x64.exe)：166,690,102 字节；SHA-256 `6bf81e4049d1ad9fddff9da79f5a8fd37c204af687315219b83ef38c266b0e4f`。
- [Photoshop 插件 ZIP](../字造-1.1.0-Photoshop插件.zip)：143,201,212 字节；SHA-256 `b99f2e44dfb2203688e55bd1fae458f14349bd83a1fda9911d0db5ddc10284dd`。
- 旧版 1.0.0 EXE 保留。两个新版文件均以不覆盖方式复制到封面目录，复制前后摘要相同。

## 离线程序结构

EXE 内置 Electron 45.2.2、Node 24.22.2、完整编辑器、字体 Worker、生产依赖及 55 个带许可证的完整字体家族。普通启动不依赖系统 Node、开发服务器或网络。

固定 `zizao://studio` 来源保持工程缓存稳定；本机服务使用随机回环端口。字体和配置保存在 `%APPDATA%/ZizaoStudio`，不写入便携包临时解压目录。便携 wrapper 使用独立解压目录；源码测试、验证产物及用户私人字体数据不进入发布资源。

## 已运行的验收

`npm run build`：退出码 0。

`npm test`：`69 tests, 69 pass, 0 fail, 0 skipped`。

`node tests/upgrade.mjs`：`UPGRADE RESULT: cases=9; passed=9; failed=0; checks=69; full`。最终构建在隔离系统字体的真实 Edge 浏览器中通过目录、拖放、描边、路径变形、合并、导出及窄屏验收。

`npx electron-builder --config desktop/builder.cjs --win portable --x64`：退出码 0。

`npm run test:desktop -- release/字造-1.1.0-离线版-x64.exe`：退出码 0，实际输出：

```text
DESKTOP RESULT: 31 checks passed; offline=true; fonts=1195; PNG=2013x624; errors=0
```

该轮把唯一 EXE 放入中文与空格目录，清空系统 Node 路径，屏蔽外网及旧开发服务，在新配置目录运行并完整重启。检查所有内置字体的文件字节、SHA-256 与许可证，实际生成简体、繁体、英文轮廓，并验证逐字移动、200/400 素材库、装饰拖放、花体/哥特、渐变材质及字体库持久化。

新目录中的原生下载回执、实际文件路径和文件大小逐项一致：PNG 839,996 字节、PSD 2,156,425 字节、逐层 PNG ZIP 990,028 字节、可编辑工程 172,329 字节。随后解码核验透明像素、PSD 图层次序及每层 PNG 的共同尺寸。实际文件位于 [最终离线验收目录](verification/desktop/run-1793842397834)，完整结果见 [portable-results.json](verification/desktop/portable-results.json)。

## Photoshop 插件

插件包包含独立 Node 运行时、Chrome 99 目标构建、完整字库和许可证。8,223 个 ZIP 条目由 Windows 独立解码器逐项读取，8,217 个已安装文件的大小与 SHA-256 与最终包一致。已安装到 `%APPDATA%/Adobe/CEP/extensions/com.zizao.title-studio`。

实际 Photoshop 27.11 的 24 项状态检查和 10 组图像比较通过；图层顺序、显隐、锁定和位置保留，72ppi/300ppi 插入目标的像素、透明度和范围差异均为 0。离线运行时 11 项、跨源桥接 11 项、发布文件 6 项检查通过。详见 [Photoshop 验收记录](verification/photoshop/FINAL-VERIFICATION.md)。

安装时 Photoshop 已运行且持有用户未保存文档，因此没有关闭或重启它。菜单刷新与 CEP 面板首次挂载尚未验证；请保存自己的文档并重启 Photoshop，从“窗口 → 扩展（旧版）→ 字造 · 封面标题工作室”打开。原生导入、协议桥接与面板首次挂载的验证边界分开记录。

## 验收工具修正

NSIS wrapper 不转发 Electron 调试就绪输出，测试通过明确的 Node inspector 与 Chromium CDP 连接实际子程序。Playwright 的 CDP 默认会接管下载到其临时 GUID 目录；测试驱动增加公开参数 `noDefaults:true`，恢复应用原生保存路径。

前后采用同一独立探针，修正后 PNG/PSD 的下载回执、Electron 主进程 fs.stat 与验收进程 fs.stat 字节完全一致。完整验收每轮使用全新目录，防止读取旧文件。本次只修改测试连接方式，最终 EXE 字节与上方摘要不变；旧版下载验收不作为新版交付证据。
