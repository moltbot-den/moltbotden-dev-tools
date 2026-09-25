#!/usr/bin/env node
/**
 * Build a standalone `mbd` executable for the current platform (Node.js
 * single executable application). No Node install is needed to run it.
 *
 *   node scripts/build-binary.mjs            → release/mbd-<os>-<arch>/mbd[.exe]
 *
 * Steps: bundle src/cli.ts into one CommonJS file (a SEA entry must be CJS and
 * can only require() builtins), generate the SEA blob with the templates/SKILL.md
 * fallback as an embedded asset, copy the running node binary and inject the
 * blob with postject. On macOS the binary is ad-hoc signed afterwards (Apple
 * Silicon refuses to run unsigned code; notarization needs a paid Apple
 * Developer account and is not done).
 *
 * The blob must be injected into the same Node version that generated it, so
 * this always uses process.execPath and builds natively on each target runner.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));

const OS = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
const ARCH = { x64: 'x64', arm64: 'arm64' }[process.arch];
if (!OS || !ARCH) throw new Error(`Unsupported build platform ${process.platform}-${process.arch}`);

const target = `${OS}-${ARCH}`;
const workDir = path.join(pkgDir, 'build', 'sea');
const outDir = path.join(pkgDir, 'release', `mbd-${target}`);
const exeName = OS === 'windows' ? 'mbd.exe' : 'mbd';
const exePath = path.join(outDir, exeName);
const bundlePath = path.join(workDir, 'cli.cjs');
const blobPath = path.join(workDir, 'sea-prep.blob');
const configPath = path.join(workDir, 'sea-config.json');

fs.rmSync(workDir, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Bundle. jq-wasm's default entry reads jq.wasm from disk next to itself,
// which does not exist inside a binary; its "inline" entry carries the wasm as
// base64, so `mbd api --jq` works with nothing on disk.
const jqInline = require.resolve('jq-wasm/inline');
await build({
  entryPoints: [path.join(pkgDir, 'src', 'cli.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  logLevel: 'warning',
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
    // CJS output has no import.meta; point it at the executable instead.
    'import.meta.url': '__mbdImportMetaUrl',
  },
  banner: { js: "const __mbdImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  plugins: [
    {
      name: 'jq-wasm-inline',
      setup(b) {
        b.onResolve({ filter: /^jq-wasm$/ }, () => ({ path: jqInline }));
      },
    },
  ],
});

// 2. SEA blob with embedded assets (read via node:sea in src/lib/standalone.ts).
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: { 'SKILL.md': path.join(pkgDir, 'templates', 'SKILL.md') },
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' });

// 3. Copy node, inject, sign.
fs.copyFileSync(process.execPath, exePath);
fs.chmodSync(exePath, 0o755);
if (OS === 'darwin') execFileSync('codesign', ['--remove-signature', exePath], { stdio: 'inherit' });

const postject = require.resolve('postject/dist/cli.js');
const postjectArgs = [
  postject,
  exePath,
  'NODE_SEA_BLOB',
  blobPath,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (OS === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, postjectArgs, { stdio: 'inherit' });

if (OS === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', exePath], { stdio: 'inherit' });

fs.copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'LICENSE'));
const sizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`Built ${path.relative(process.cwd(), exePath)} (${pkg.version}, ${target}, node ${process.versions.node}, ${sizeMb} MB)`);
