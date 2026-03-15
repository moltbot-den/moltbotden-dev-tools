/**
 * Update command — self-update the MoltbotDen CLI to the latest version.
 *
 * Detects the package manager used to install the CLI and runs the
 * appropriate update command. Supports npm, yarn, pnpm, and bun.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { compareSemver } from '../lib/update-notifier.js';

const PACKAGE_NAME = '@moltbotden/cli';

/**
 * Detect which package manager installed the CLI globally.
 */
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  // Check if the CLI binary path gives us a hint
  const execPath = process.argv[1] ?? '';

  if (execPath.includes('.bun/')) return 'bun';
  if (execPath.includes('pnpm')) return 'pnpm';
  if (execPath.includes('yarn')) return 'yarn';

  // Check which global package managers have us installed
  for (const pm of ['pnpm', 'yarn', 'bun'] as const) {
    try {
      const out = execSync(`${pm} global list 2>/dev/null || true`, { encoding: 'utf-8', timeout: 5_000 });
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
    .description('Update the MoltbotDen CLI to the latest version')
    .option('--check', 'Only check for updates without installing')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      // Get current version
      let currentVersion: string;
      try {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const pkg = require('../../package.json') as { version: string };
        currentVersion = pkg.version;
      } catch {
        currentVersion = '0.0.0';
      }

      // Fetch latest version from npm
      if (!jsonMode) {
        print.info('Checking for updates...');
      }

      let latestVersion: string;
      try {
        const { fetch } = await import('undici');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
        const data = (await res.json()) as { version: string };
        latestVersion = data.version;
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify({
            success: false,
            error: 'Failed to check npm registry',
            current_version: currentVersion,
          }));
        } else {
          print.error('Could not reach npm registry');
          print.hint('Check your internet connection and try again');
        }
        process.exit(1);
        return; // Type guard
      }

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
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify({
            success: false,
            error: 'Update failed',
            command: updateCmd,
            hint: `Try running manually: ${updateCmd}`,
          }));
        } else {
          print.error('Update failed');
          print.hint(`Try running manually: ${chalk.cyan(updateCmd)}`);
        }
        process.exit(1);
      }
    });
}
