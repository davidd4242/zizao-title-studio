// 单一安装包：把主程序、图文说明书、练习素材和 Photoshop 插件一起装进一个 EXE。
// 复用 desktop/builder.cjs 的冻结应用内容，只替换目标类型为 NSIS 安装程序。
const base = require('./builder.cjs');

module.exports = {
  ...base,
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '字造',
    artifactName: '字造-1.5.0-完整安装版.exe',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    include: 'desktop/installer.nsh',
  },
  // 随包资料由 desktop/installer.nsh 在安装阶段写入 $INSTDIR\使用说明。
  // 这里不能用 extraFiles：--prepackaged 只打包已有目录，不会执行资源复制步骤。
};
