# 内置字体资源

本目录包含 55 个字体家族的完整原始 TTF 文件，字体二进制合计 152,527,768 字节（145.46 MiB）。其中 15 个中文家族、40 个英文家族。11 个家族通过简体样本，9 个通过繁体样本；两组有重叠。全部 55 个家族通过 95 个可打印 ASCII 字符。

字体文件来自 [Google Fonts 固定版本](https://github.com/google/fonts/tree/bbda7253fc363238b05d97515ca71f8ae49c4fa9)。没有使用 CSS 分片、裁剪字符集、改名或修改字体二进制。每个家族保留一个 normal 文件；可变字体的完整轴数据保留在原文件中，当前轮廓服务使用文件的默认实例。

[manifest.json](./manifest.json) 记录每个家族的固定源链接、下载链接、上游仓库、SHA-256、字节数、许可证、语言样本结果和字形数量。每个家族目录中的 METADATA.pb 保留原作者与版权信息，OFL.txt 或 LICENSE.txt 保留该家族的完整许可证。

## 再分发

50 个家族采用 SIL Open Font License 1.1，5 个采用 Apache License 2.0。Apache 家族为 Luckiest Guy、Chewy、Permanent Marker、Satisfy、Ultra。固定上游版本中，这些 Apache 目录没有独立 NOTICE 文件；目录证据记录在 [source-tree.json](../../verification/bundled-fonts/source-tree.json)。

两类许可证允许商业使用、随软件打包和再分发。分发时保留本目录、各家族完整许可证、原作者和版权信息。OFL 字体须继续采用 OFL，字体本身不得单独售卖；修改版还应遵守保留字体名称条款。使用字体生成的图形作品不继承字体许可证。具体条款以各目录内的原文为准。

## 离线校验与恢复

在项目根目录运行 `node scripts/prepare-fonts.mjs --verify`，可离线校验每个字体、许可证和原始元数据的哈希、体积与语言样本。校验详情写入 [coverage-license-report.json](../../verification/bundled-fonts/coverage-license-report.json)。语言标签表示清单列出的每个测试码点均存在，并不表示覆盖该语言的所有汉字或字符。

运行 `node scripts/prepare-fonts.mjs` 可按现有清单恢复缺失或损坏的资源，只接受锁定的 SHA-256。修改候选列表后，运行 `node scripts/prepare-fonts.mjs --refresh-manifest` 明确重建清单；已有来源仍校验原哈希。清单在全部文件下载并验证后原子发布。清理淘汰候选应保留其证据副本，避免打包额外文件。

运行 `node --test tests/font-bundled.test.mjs tests/font-service.test.mjs` 可验证所有样本的横竖排真实轮廓、中文分类、无系统字体的默认字体、重启缓存、移动解压目录后的稳定 ID、禁用内置字体和损坏文件处理。逐家族轮廓结果见 [worker-outline-report.json](../../verification/bundled-fonts/worker-outline-report.json)。

## 运行时与打包

字体服务默认从 `assets/fonts` 读取清单，无需系统安装、网络或浏览器字体加载。内置字体 ID 由稳定的清单身份、face index 和 PostScript 名生成，不包含机器上的绝对路径。系统字体和用户导入字体保留原有路径身份规则。

打包时完整复制 `assets/fonts/**`。独立测试可设置 `includeBundledFonts: false`；便携目录测试可传入 `bundledFontsDir`。这两个选项都透传给真实 font worker。
