module.exports = {
  appId: 'studio.zizao.desktop',
  productName: '字造',
  executableName: '字造',
  copyright: '字造 · 封面标题工作室',
  asar: false,
  compression: 'maximum',
  directories: { output: 'release', buildResources: 'desktop' },
  files: [
    'dist/**/*', 'desktop/main.cjs', 'desktop/icon.ico', 'desktop/loading.html',
    'server/index.mjs', 'server/font-worker.mjs', 'server/outline.mjs', 'assets/fonts/**/*', 'package.json',
    '!node_modules/**/*.{md,ts,map}', '!node_modules/**/test{,s}/**', '!node_modules/**/example{,s}/**',
  ],
  win: { target: [{ target: 'portable', arch: ['x64'] }], icon: 'desktop/icon.ico', signAndEditExecutable: true, artifactName: '字造.exe' },
  portable: { requestExecutionLevel: 'user', unpackDirName: true, splashImage: 'desktop/splash.bmp' },
  electronLanguages: ['zh-CN', 'en-US'],
  npmRebuild: false,
  publish: null,
};
