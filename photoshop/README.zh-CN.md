# 字造 Photoshop 插件

在 Photoshop 面板中编辑标题、字体、材质和矢量装饰，再将透明分层 PSD 送入文档。安装包包含编辑器、独立 Node.js 运行时、字体服务和完整内置字体。日常编辑可离线运行，无需预装 Node 或另开浏览器。

## 安装与升级

适配目标为 Windows x64、带 CEP 12 的 Photoshop 25.12–27.x。此包是未签名 CEP 开发扩展。包版本记录在 `com.zizao.title-studio/package-manifest.json`，与编辑器和 CEP manifest 一致。历史原生文档测试和新版浏览器测试的范围见下方“测试范围”。

1. 将 ZIP **完整解压**到独立目录，保留 `com.zizao.title-studio` 文件夹及旁边的安装脚本。这个包有 8200 多个文件，解压需要一两分钟，中途不要取消；如果 `Install.cmd` 提示 Package is incomplete，说明解压不完整（常见于中途取消或被杀毒软件删掉文件），删掉目录重新完整解压即可。可以保留先前版本的 ZIP 和解压目录。
2. 保存 Photoshop 中的工作，并关闭字造面板。运行 `Install.cmd`。安装脚本校验每个资源的 SHA-256，再复制到当前用户的 `%APPDATA%\Adobe\CEP\extensions\com.zizao.title-studio`，无需管理员权限。
3. 若提示 CEP 开发扩展开关尚未启用，在解压目录打开 PowerShell，执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -EnableDeveloperMode`。这个显式选项只写当前用户 `HKCU\Software\Adobe\CSXS.12\PlayerDebugMode=1`，并记录先前值以供卸载恢复。普通安装保持该设置原样。
4. 重新启动 Photoshop，在“窗口 → 扩展（旧版）→ 字造”打开面板。将面板拉宽以使用完整工作台。

安装脚本保留 Photoshop 程序文件、其它首选项和系统字体。升级时原插件移入 `%LOCALAPPDATA%\ZizaoPhotoshop\backups`。字体导入和缓存位于 `%LOCALAPPDATA%\ZizaoPhotoshop`，插件目录可独立替换。正在打开的工作文档由你保存和关闭，安装脚本不会处理文档。

## 编辑与送入 Photoshop

工作台包含文字风格、字体筛选、逐字排版、路径编辑、分色矢量装饰、透明图片和图层管理。装饰支持点击加入、拖到画布指定位置或拖到图层区。可将工程保存为 `.zizao.json`，之后继续编辑。

打开“导出标题”，设置范围与精度，然后选择：

- **送入 PS 新文档**：默认方式。创建新的未保存 Photoshop 文档，保留导出的独立图层；原有工作文档保持原样。
- **插入当前 PS 文档**：把导出的图层放进当前文档的新图层组，并按原像素坐标放置。执行前在 Photoshop 中激活目标文档；目标画布小于导出内容时，超出部分位于画布外。

PSD 中的文字和装饰是带透明度的像素图层。文字、颜色和节点可继续在字造工程中修改，再重新导出。导出面板也提供透明 PNG、逐层 PNG、分层 PSD 和 SVG。文档的保存位置由你决定，插件不自动保存现有文件。

单次 PSD 传输上限为 128 MiB。大画布可以降低输出精度或缩小导出范围。若导入响应超时，先检查 Photoshop 弹窗和实际文档，再决定是否重试。

## 离线运行和工程保存

内置 Node 只监听 `127.0.0.1`，首选端口为 4200，被占用时自动选择空闲端口。每次启动生成独立令牌，字体 API 只接受本实例请求。编辑器 iframe 禁用 Node 接口。宿主只接收新建文档和插入图层两种 PSD 请求。关闭面板会结束其字体服务并清理临时 PSD。

自动恢复内容按本地服务来源保存。若首选端口被占用，来源会变化，请通过“保存工程”保存重要内容，再从工程文件恢复。Photoshop 也可能清理扩展浏览器缓存；工程文件适合长期保存。

完整字体及各家族的许可证位于 `com.zizao.title-studio/packages/editor/assets/fonts`。Node 及其所含第三方库许可证位于 `com.zizao.title-studio/runtime/LICENSE-Node.txt`。生产依赖清单在 `com.zizao.title-studio/THIRD-PARTY.json`，对应依赖目录保留上游许可证。

## 卸载与恢复

保存工作并关闭字造面板后运行 `Uninstall.cmd`，然后重启 Photoshop。卸载会将本扩展移到恢复目录，保留字体缓存、关联目录及工程数据。只有本安装显式修改过 CEP 开发开关且当前值仍为 1 时，卸载才恢复原值；本来开启的设置保持原样。

若面板显示“字体服务已结束”，关闭并重新打开面板。若菜单没有显示字造，确认 Photoshop 版本、安装目录和 CEP 12 开关，再保存工作并重启 Photoshop。扩展菜单通常在 Photoshop 启动时刷新。

## 测试范围

1.1.0 阶段曾在 Photoshop 27.11 上直接执行原生文档导入脚本。历史结果为 24 项状态检查和 10 组全像素比较通过，覆盖新文档、插入图层、显隐、锁定、层序及不同分辨率文档。它验证的是当时的导入脚本和样本；该结果不代表 1.3.0 已在 Photoshop 内完成回归，也没有验证 CEP 面板首次挂载。

1.3.0 的实包检查使用 Edge 加载包内 Chrome 99 目标构建，连接包内 Node 与真实字体服务。检查范围包括十种字形的真实界面操作、预览与工程数据、透明 PNG、分层 PSD 字节和跨源 MessageChannel。测试接收端解析 PSD，不调用 Adobe 文档接口。每次构建的 `verification/FINAL-VERIFICATION.md` 与 JSON 报告分别记录已执行的命令、结果和浏览器版本。

Chrome 99 是编译目标，Edge 的通过结果不等于 CEP 12 Chromium 99 宿主实测。新版扩展菜单刷新、首次面板挂载以及 Photoshop 内完整交互仍待原生验证；其它 Photoshop 版本也需分别复核。发行验收保持已安装插件和未保存文档原状，不自动重启 Photoshop。

## 构建和核验

在主编辑器最终构建完成、源码冻结后运行 `node scripts/package-photoshop.mjs`。每次构建写入独立的 `verification/photoshop/release/build-*` 目录；其中的 `release.json` 记录本包路径、大小和 SHA-256，`release/latest.json` 指向最近一次构建。先前版本的构建目录保留。

插件从同一份冻结源码独立编译为 Chrome 99 目标，适配 CEP 12。插件构建与主 `dist` 使用不同目标，字节和文件名可能不同。打包过程不会修改主 `dist`；`com.zizao.title-studio/build-evidence.json` 分别记录源码、主 `dist` 和插件编辑器的文件指纹。打包过程若发现源码或主 `dist` 改变，会停止发布该包。

构建复制完整生产依赖闭包、字体和当前独立 Node 可执行文件。首次使用某个 Node 版本时下载对应官方完整许可证并缓存，后续可离线重建。验收脚本通过 `ZIZAO_RELEASE_RECORD` 选择特定构建的 `release.json`，报告写入该构建的 `verification` 目录，不覆盖旧版报告。ZIP 核验使用 Windows 的独立解压库，逐条检查解压后的大小和 SHA-256。

Adobe CEP 12 文档：https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md

Node.js 来源：https://nodejs.org/dist/
