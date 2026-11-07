// Builds the EasyEDA Pro extension: easyeda-extension/dist/benchtop-easyeda.eext
// (an .eext is a zip: extension.json, dist/index.js, images/, locales/).
// Run: npm run build:easyeda
import { build } from 'esbuild';
import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'easyeda-extension');
const manifest = JSON.parse(await readFile(path.join(root, 'extension.json'), 'utf8'));

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(root, 'dist', 'index.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'edaEsbuildExportName', // what EasyEDA's loader looks for
  target: 'es2020',
  minify: false,
  logLevel: 'warning',
});

const zip = new JSZip();
const add = async (rel) => zip.file(rel, await readFile(path.join(root, rel)));
await add('extension.json');
await add('dist/index.js');
await add('images/logo.png');
await add('locales/en.json');
await add('locales/zh-Hans.json');
await add('README.md');

const out = path.join(root, 'dist', 'benchtop-easyeda.eext');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Built ${path.relative(process.cwd(), out)} (v${manifest.version})`);
