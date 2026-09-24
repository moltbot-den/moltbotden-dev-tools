import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  minify: false,
  sourcemap: true,
  target: 'node22',
  shims: true,
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
