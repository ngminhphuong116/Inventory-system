import { readdir, readFile, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version');
const destination = join(root, 'release', pkg.version, 'github-source');
if (!destination.startsWith(join(root, 'release') + '\\')) throw new Error('Invalid source staging path');
if (existsSync(join(destination, '.git'))) throw new Error('Source output has become a Git repository. Preserve it and choose a new release version before exporting.');
await rm(destination, { recursive: true, force: true });
// Explicit publication allowlist: never copy .git/history, local config, reports or business assets.
const roots = ['src', 'public', 'functions/src', 'tests', 'docs/screenshots', '.github',
  'package.json', 'package-lock.json', 'functions/package.json', 'functions/package-lock.json',
  'functions/tsconfig.json', 'index.html', 'main.js', 'preload.cjs', 'vite.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'eslint.config.js',
  'electron-builder.config.cjs', '.gitignore', '.firebaserc.example', 'firebase.json',
  'database.rules.json', 'README.md', 'FIREBASE_DEPLOYMENT.md', 'RELEASE_NOTES.md',
  'docs/INSTALLATION.md', 'docs/RELEASE_VALIDATION.md', 'docs/GITHUB_PUBLICATION.md',
  'scripts/build-release.mjs', 'scripts/export-source.mjs', 'scripts/release-checksums.mjs',
  'scripts/smoke-sales-receipt.mjs', 'scripts/clean-electron.ps1',
  'scripts/smoke-installed.mjs', 'scripts/acceptance-install.ps1', 'scripts/smoke-release-files.mjs',
  'scripts/prepare-release-assets.ps1',
  'scripts/production-backup.ps1', 'scripts/production-audit.ps1', 'scripts/deploy-production-rules.ps1'];
const paths = [];
async function collect(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const full = join(path, item.name);
    if (item.isDirectory()) await collect(full);
    else if (item.isFile()) paths.push(full);
    else throw new Error(`Unsupported source entry: ${full}`);
  }
}
for (const item of roots) {
  const path = join(root, item);
  if (!item.includes('.') || ['functions/src', 'docs/screenshots', '.github'].includes(item)) await collect(path);
  else paths.push(path);
}
const manifest = [];
for (const path of paths.sort()) {
  const name = relative(root, path).replaceAll('\\', '/');
  if (name.startsWith('src/assets/') && !/\.(?:woff2?|svg)$/.test(name)) continue;
  const data = await readFile(path);
  if (/\.(?:[cm]?js|tsx?|json|md|ya?ml|ps1|html|css)$/.test(name)) {
    const value = data.toString('utf8');
    const forbidden = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AIza[\w-]{30,}/,
      /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/,
      /(?:^|[\s"'=(])[A-Z]:\\(?:Users|SoftWare)\\/im];
    if (forbidden.some(pattern => pattern.test(value))) throw new Error(`Private/local content requires review: ${name}`);
  }
  const target = join(destination, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  await copyFile(path, target);
  manifest.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await writeFile(join(root, 'release', pkg.version, 'SOURCE_MANIFEST.sha256'), manifest.join('\n') + '\n');
console.log(`Exported ${manifest.length} source files to ${destination}`);
