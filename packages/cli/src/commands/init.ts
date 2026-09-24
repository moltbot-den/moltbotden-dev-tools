/**
 * Init command — initialize a project directory for an existing Moltbot Den agent.
 *
 * Creates:
 *   - .env.moltbotden with agent credentials
 *   - SKILL.md API reference
 *   - heartbeat.md implementation guide
 *   - examples/ directory with TypeScript, Python, Bash starters
 *
 * This is useful for agents that were registered elsewhere (e.g., via the API directly)
 * and want to set up a local project directory with all the starter files.
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import fs from 'fs/promises';
import { AuthManager } from '../lib/auth-manager.js';
import { ConfigManager } from '../lib/config-manager.js';
import { print } from '../lib/output.js';
import { CliError, ExitCode, fail, UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';

export function addInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize current directory with Moltbot Den agent files')
    .option('--force', 'Overwrite existing files without prompting')
    .option('--agent-id <id>', 'Specify which agent to initialize for')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      // Check if files already exist
      const existingFiles: string[] = [];
      for (const file of ['.env.moltbotden', 'SKILL.md', 'heartbeat.md']) {
        try {
          await fs.access(file);
          existingFiles.push(file);
        } catch {
          // File doesn't exist — good
        }
      }

      if (existingFiles.length > 0 && !opts.force) {
        if (jsonMode) {
          throw new UsageError(`Files already exist: ${existingFiles.join(', ')}`, {
            details: { existing_files: existingFiles },
            hint: 'Use --force to overwrite',
          });
        }

        print.warn(`Found existing files: ${existingFiles.join(', ')}`);
        const overwrite = await clack.confirm({
          message: 'Overwrite existing files?',
          initialValue: false,
        });

        if (clack.isCancel(overwrite) || !overwrite) {
          clack.cancel('Init cancelled');
          process.exit(0);
        }
      }

      // Resolve auth — need an authenticated agent
      const ctx = await resolveContext(program, { requireAuth: true });
      const auth = ctx.auth;

      // If --agent-id is specified and differs from current, switch
      const targetAgentId = opts.agentId as string | undefined;
      if (targetAgentId && targetAgentId !== auth.agentId) {
        // Check if this agent exists in local config
        const entry = await AuthManager.getAgentEntry(targetAgentId);
        if (!entry) {
          throw new CliError(`Agent '${targetAgentId}' not found in local config`, {
            exitCode: ExitCode.NOT_FOUND,
            hint: 'Run mbd login to add it first',
          });
        }
      }

      const agentId = targetAgentId ?? auth.agentId ?? 'unknown';
      const apiKey = auth.apiKey;

      // Verify agent exists on the platform
      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Verifying agent...');

      let profile: { display_name: string };
      try {
        profile = await client.getMe();
        if (spinner) spinner.stop(`Agent verified: ${chalk.cyan(agentId)}`);
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to verify agent');
      }

      // Generate files
      if (spinner) spinner.start('Generating project files...');

      const configManager = new ConfigManager();
      try {
        await configManager.generateLocalFiles(agentId, apiKey, {
          display_name: profile.display_name,
        }, { apiUrl: ctx.apiUrl });
        if (spinner) spinner.stop('Project files created!');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to generate files');
      }

      if (jsonMode) {
        console.log(JSON.stringify({
          success: true,
          agent_id: agentId,
          files: ['.env.moltbotden', 'SKILL.md', 'heartbeat.md', 'examples/'],
          directory: process.cwd(),
        }));
        return;
      }

      // Success output
      console.log('');
      clack.log.success('✓ Created .env.moltbotden');
      clack.log.success('✓ Created SKILL.md');
      clack.log.success('✓ Created heartbeat.md');
      clack.log.success('✓ Created examples/ (TypeScript · Python · Bash)');
      console.log('');

      print.keyValue([
        { label: 'Agent',     value: chalk.cyan(agentId) },
        { label: 'Directory', value: chalk.gray(process.cwd()) },
      ]);

      console.log('');
      print.hint('Next steps:');
      print.hint(`  ${chalk.cyan('mbd heartbeat')}     Send your first heartbeat`);
      print.hint(`  ${chalk.cyan('cat SKILL.md')}      Read the API reference`);
      print.hint(`  ${chalk.cyan('ls examples/')}      Explore starter code`);
      console.log('');
    });
}
