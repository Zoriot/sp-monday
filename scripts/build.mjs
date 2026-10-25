#!/usr/bin/env node
/**
 * Builds the plugin into dist/ and, with --zip, packs it into
 * release/sp-monday-<version>.zip for Super Productivity → Settings → Plugins.
 */
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const isZip = process.argv.includes('--zip');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [path.join(SRC, 'plugin.ts')],
  outfile: path.join(DIST, 'plugin.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  alias: {
    '@sp/plugin-api': path.join(ROOT, 'vendor/plugin-api/index.ts'),
  },
});

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

fs.copyFileSync(path.join(SRC, 'icon.svg'), path.join(DIST, 'icon.svg'));

const i18nSrc = path.join(SRC, 'i18n');
if (fs.existsSync(i18nSrc)) {
  const i18nDist = path.join(DIST, 'i18n');
  fs.mkdirSync(i18nDist);
  for (const file of fs.readdirSync(i18nSrc)) {
    if (file.endsWith('.json')) {
      fs.copyFileSync(path.join(i18nSrc, file), path.join(i18nDist, file));
    }
  }
}

console.log('Build complete → dist/');

if (isZip) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(DIST, full).split(path.sep).join('/')] = fs.readFileSync(full);
      }
    }
  };
  walk(DIST);
  fs.mkdirSync(RELEASE, { recursive: true });
  const zipPath = path.join(RELEASE, `sp-monday-${pkg.version}.zip`);
  fs.writeFileSync(zipPath, zipSync(files, { level: 9 }));
  console.log(`Packed ${path.relative(ROOT, zipPath)}`);
}
