/**
 * Update command — self-update the Moltbot Den CLI to the latest version.
 *
 * Detects the package manager used to install the CLI and runs the
 * appropriate update command. Supports npm, yarn, pnpm, and bun.
 */

import { Command } from 'commander';
import { execFileSync, execSync } from 'node:child_process';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { compareSemver, fetchLatestVersion, PACKAGE_NAME } from '../lib/update-notifier.js';
import { CLI_VERSION } from '../lib/version.js';
import { CliError } from '../lib/errors.js';
import { isStandalone, standaloneUpgradeCommand } from '../lib/standalone.js';

/**
 * Detect which package manager installed the CLI globally.
 */
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  // Check if the CLI binary path gives us a hint
  const execPath = process.argv[1] ?? '';

  const normalized = execPath.replace(/\\/g, '/');
  if (normalized.includes('.bun/')) return 'bun';
  if (normalized.includes('pnpm')) return 'pnpm';
  if (normalized.includes('yarn')) return 'yarn';

  // Check which global package managers have us installed
  const listArgs = { pnpm: ['ls', '-g'], yarn: ['global', 'list'], bun: ['pm', 'ls', '-g'] } as const;
  for (const pm of ['pnpm', 'yarn', 'bun'] as const) {
    try {
      const out = execFileSync(pm, [...listArgs[pm]], {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32',
      });
      if (out.includes(PACKAGE_NAME)) return pm;
    } catch {
      // Not installed or command failed
    }
  }

  return 'npm'; // Default
}

/**
 * Get the installed update commands for each package manager.
 */
function getUpdateCommand(pm: string): string {
  switch (pm) {
    case 'yarn':  return `yarn global add ${PACKAGE_NAME}@latest`;
    case 'pnpm':  return `pnpm add -g ${PACKAGE_NAME}@latest`;
    case 'bun':   return `bun add -g ${PACKAGE_NAME}@latest`;
    default:      return `npm install -g ${PACKAGE_NAME}@latest`;
  }
}

export function addUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update the Moltbot Den CLI to the latest version')
    .option('--check', 'Only check for updates without installing')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const currentVersion = CLI_VERSION;

      // Fetch latest version from npm
      if (!jsonMode) {
        print.info('Checking for updates...');
      }

      const latest = await fetchLatestVersion(10_000);
      if (!latest) {
        throw new CliError('Could not reach the npm registry to check for updates', {
          details: { current_version: currentVersion },
          hint: 'Check your internet connection and try again',
        });
      }
      const latestVersion: string = latest;

      const isUpToDate = compareSemver(latestVersion, currentVersion) <= 0;

      // --check mode: just report
      if (opts.check) {
        if (jsonMode) {
          console.log(JSON.stringify({
            current_version: currentVersion,
            latest_version: latestVersion,
            up_to_date: isUpToDate,
          }));
        } else if (isUpToDate) {
          print.success(`You're on the latest version (${chalk.cyan(currentVersion)})`);
        } else {
          print.info(`Update available: ${chalk.gray(currentVersion)} → ${chalk.green(latestVersion)}`);
          print.hint(`Run ${chalk.cyan('mbd update')} to install`);
        }
        return;
      }

      // Already up to date
      if (isUpToDate) {
        if (jsonMode) {
          console.log(JSON.stringify({
            success: true,
            current_version: currentVersion,
            latest_version: latestVersion,
            message: 'Already up to date',
          }));
        } else {
          print.success(`Already on the latest version (${chalk.cyan(currentVersion)})`);
        }
        return;
      }

      // A standalone binary has no package manager: it is upgraded by the tool
      // that installed it (Homebrew or the install script), so print that
      // command instead of running npm against an installation it does not own.
      if (isStandalone()) {
        const upgradeCmd = standaloneUpgradeCommand();
        if (jsonMode) {
          console.log(JSON.stringify({
            success: false,
            current_version: currentVersion,
            latest_version: latestVersion,
            install_method: 'standalone',
            update_command: upgradeCmd,
          }));
        } else {
          print.info(`Update available: ${chalk.gray(currentVersion)} → ${chalk.green(latestVersion)}`);
          print.hint(`This is a standalone binary. Upgrade it with: ${chalk.cyan(upgradeCmd)}`);
        }
        return;
      }

      // Perform the update
      const pm = detectPackageManager();
      const updateCmd = getUpdateCommand(pm);

      if (!jsonMode) {
        console.log('');
        print.info(`Updating ${chalk.gray(currentVersion)} → ${chalk.green(latestVersion)}`);
        print.info(`Using ${chalk.cyan(pm)}: ${chalk.gray(updateCmd)}`);
        console.log('');
      }

      try {
        execSync(updateCmd, {
          stdio: jsonMode ? 'pipe' : 'inherit',
          timeout: 60_000,
        });

        if (jsonMode) {
          console.log(JSON.stringify({
            success: true,
            previous_version: currentVersion,
            new_version: latestVersion,
            package_manager: pm,
          }));
        } else {
          console.log('');
          print.success(`Updated to ${chalk.green(latestVersion)}!`);
        }
      } catch {
        throw new CliError('Update failed', {
          details: { command: updateCmd },
          hint: `Try running manually: ${updateCmd}` +
            (process.platform === 'win32' ? '\nOn Windows, close other running mbd/moltbotden processes first.' : ''),
        });
      }
    });
}
