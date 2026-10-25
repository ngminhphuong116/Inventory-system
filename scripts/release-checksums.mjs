import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const directory = join(root, 'release', version, 'assets');
const files = (await readdir(directory, { withFileTypes: true }))
  .filter(item => item.isFile() && item.name !== 'SHA256SUMS.txt').map(item => item.name).sort();
if (!files.some(file => file.endsWith('.exe'))) throw new Error('Installer missing from release assets');
const lines = [];
for (const file of files) lines.push(`${createHash('sha256').update(await readFile(join(directory, file))).digest('hex')}  ${file}`);
await writeFile(join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(join(directory, 'SHA256SUMS.txt'));
