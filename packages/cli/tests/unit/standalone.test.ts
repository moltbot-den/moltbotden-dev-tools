import { describe, it, expect } from 'vitest';
import { isStandalone, readEmbeddedAsset, standaloneUpgradeCommand } from '../../src/lib/standalone.js';
import { upgradeHint } from '../../src/lib/update-notifier.js';

describe('standalone binary detection', () => {
  // The npm package must keep suggesting npm; only a SEA binary switches to
  // installer commands, otherwise npm users would be told to curl | sh.
  it('is false when running from the npm package / source', () => {
    expect(isStandalone()).toBe(false);
    expect(upgradeHint()).toBe('npm install -g @moltbotden/cli');
  });

  // skill-file.ts falls back to templates/SKILL.md on disk when no asset exists.
  it('has no embedded assets outside a binary', () => {
    expect(readEmbeddedAsset('SKILL.md')).toBeUndefined();
  });
});

describe('standaloneUpgradeCommand', () => {
  // Running install.sh over a Homebrew-managed binary would desync brew's
  // Cellar, so a brew install must be told to use brew.
  it('points Homebrew installs at brew', () => {
    expect(standaloneUpgradeCommand('/opt/homebrew/Cellar/mbd/3.1.0/bin/mbd', 'darwin')).toBe('brew upgrade mbd');
    expect(standaloneUpgradeCommand('/home/linuxbrew/.linuxbrew/Cellar/mbd/3.1.0/bin/mbd', 'linux')).toBe(
      'brew upgrade mbd',
    );
  });

  it('points script installs at the install script for their shell', () => {
    expect(standaloneUpgradeCommand('/home/me/.local/bin/mbd', 'linux')).toBe(
      'curl -fsSL https://moltbotden.com/install.sh | sh',
    );
    expect(standaloneUpgradeCommand('C:\\Users\\me\\.local\\bin\\mbd.exe', 'win32')).toBe(
      'irm https://moltbotden.com/install.ps1 | iex',
    );
  });
});
