import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'electron-builder';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const qa = process.argv.includes('--qa');
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version');
for (const [cli, args] of [['typescript/bin/tsc', ['-b']], ['vite/bin/vite.js', ['build']]]) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules', cli), ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Frontend build failed: ${cli}`);
}
const appDir = join(root, 'release', pkg.version, 'app');
if (!appDir.startsWith(join(root, 'release') + '\\')) throw new Error('Invalid staging path');
await rm(appDir, { recursive: true, force: true });
await mkdir(join(appDir, 'public'), { recursive: true });
await mkdir(join(appDir, 'node_modules'), { recursive: true });
await cp(join(root, 'dist'), join(appDir, 'dist'), { recursive: true, force: true });
await mkdir(join(appDir, 'third-party-licenses'), { recursive: true });
await cp(join(root, 'node_modules/@fontsource/be-vietnam-pro/LICENSE'), join(appDir, 'third-party-licenses/BeVietnamPro-OFL.txt'));
for (const file of ['main.js', 'preload.cjs', 'public/favicon.ico', 'public/favicon.svg']) {
  await cp(join(root, file), join(appDir, file));
}
// Renderer dependencies are bundled by Vite. Main/preload import only Node/Electron.
// Do not ship Firebase CLI, build tools, credentials or previous installers.
await writeFile(join(appDir, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, description: pkg.description,
  type: pkg.type, main: pkg.main, private: true, dependencies: {},
}, null, 2));
const config = createRequire(import.meta.url)('../electron-builder.config.cjs');
await build({ projectDir: appDir, config: {
  ...config,
  ...(qa ? { appId: 'com.quanlykho.releaseqa', productName: 'QuanLyKhoHang Release QA', executableName: 'QuanLyKhoHangReleaseQA' } : {}),
  directories: { output: join(root, 'release', pkg.version, qa ? 'qa-installers' : 'installers') },
  win: { ...config.win, icon: join(root, 'public/favicon.ico') },
  ...(qa ? { nsis: { ...config.nsis, shortcutName: 'QuanLyKhoHang Release QA', uninstallDisplayName: 'QuanLyKhoHang Release QA' } } : {}),
}, publish: 'never' });
