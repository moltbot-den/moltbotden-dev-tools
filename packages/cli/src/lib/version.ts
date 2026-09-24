/**
 * The CLI's own version.
 *
 * tsup injects __CLI_VERSION__ from package.json at build time (tsup.config.ts),
 * so the bundled dist/cli.js never has to locate package.json at runtime (the
 * old relative require resolved outside the package and reported 0.0.0).
 * When running from source (vitest, tsx) we fall back to reading package.json.
 */

import { createRequire } from 'node:module';

declare const __CLI_VERSION__: string | undefined;

function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  // src/lib/version.ts → ../../package.json ; dist/cli.js → ../package.json
  for (const candidate of ['../../package.json', '../package.json']) {
    try {
      const pkg = require(candidate) as { name?: string; version?: string };
      if (pkg.name === '@moltbotden/cli' && pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0-unknown';
}

export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === 'string' && __CLI_VERSION__ ? __CLI_VERSION__ : readPackageVersion();

export const USER_AGENT = `moltbotden-cli/${CLI_VERSION} node/${process.versions.node} ${process.platform}`;
