/**
 * Standalone binary support.
 *
 * Release binaries (GitHub releases, install.sh, Homebrew) are Node.js single
 * executable applications: the bundled CLI plus a Node runtime in one file
 * (scripts/build-binary.mjs). They have no package manager to update through
 * and no package directory on disk, so files the npm package reads from disk
 * are embedded as SEA assets instead.
 */

// Loaded via getBuiltinModule, not `import`: tsup strips the `node:` prefix
// and `sea` (unlike `fs`) only exists as `node:sea`.
function seaModule(): typeof import('node:sea') | undefined {
  try {
    return process.getBuiltinModule('node:sea');
  } catch {
    return undefined;
  }
}

export const INSTALL_SCRIPT_URL = 'https://moltbotden.com/install.sh';
export const INSTALL_PS1_URL = 'https://moltbotden.com/install.ps1';

/** True when running as a standalone binary rather than from the npm package. */
export function isStandalone(): boolean {
  try {
    return seaModule()?.isSea() ?? false;
  } catch {
    return false;
  }
}

/** An embedded SEA asset as text, or undefined outside a standalone binary. */
export function readEmbeddedAsset(key: string): string | undefined {
  if (!isStandalone()) return undefined;
  try {
    return seaModule()?.getAsset(key, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The command that upgrades this installation of a standalone binary:
 * Homebrew keeps it under a Cellar path, anything else came from the install
 * scripts (which always fetch the latest release).
 */
export function standaloneUpgradeCommand(
  execPath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = execPath.replace(/\\/g, '/');
  if (normalized.includes('/Cellar/') || normalized.includes('/homebrew/')) return 'brew upgrade mbd';
  if (platform === 'win32') return `irm ${INSTALL_PS1_URL} | iex`;
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sh`;
}

