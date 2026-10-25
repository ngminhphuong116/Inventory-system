const path = require('node:path');
const { version } = require('./package.json');

module.exports = {
  appId: 'com.quanlykho.app',
  productName: 'QuanLyKhoHang',
  electronVersion: require('./node_modules/electron/package.json').version,
  electronDist: path.join(__dirname, 'node_modules/electron/dist'),
  directories: {
    app: `release/${version}/app`,
    output: `release/${version}/installers`,
  },
  asar: true,
  compression: 'normal',
  npmRebuild: false,
  files: ['dist/**/*', 'main.js', 'preload.cjs', 'public/favicon.ico', 'public/favicon.svg', 'third-party-licenses/**/*', 'package.json'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'public/favicon.ico',
    artifactName: 'QuanLyKhoHang-${version}-windows-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'QuanLyKhoHang',
    uninstallDisplayName: 'QuanLyKhoHang',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
};
