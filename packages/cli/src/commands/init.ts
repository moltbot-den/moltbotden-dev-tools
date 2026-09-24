/**
 * init: set up the current directory for an existing agent.
 *
 * Writes .env.moltbotden (0600, gitignored), SKILL.md (fetched live from
 * https://moltbotden.com/skill.md, bundled copy when offline), heartbeat.md
 * and examples/.
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { ConfigManager, existingStarterKitFiles } from '../lib/config-manager.js';
import { print } from '../lib/output.js';
import { CliError, ExitCode, UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';
import { isInteractive } from '../lib/prompts.js';
import { withExamples, withSpinner } from '../lib/ui.js';

export function addInitCommand(program: Command): void {
  withExamples(
    program
      .command('init')
      .description('Write the agent starter kit (.env.moltbotden, SKILL.md, heartbeat.md, examples/) here')
      .option('--force', 'Overwrite existing files without prompting')
      .option('--agent-id <id>', 'Use this locally stored agent instead of the current one'),
    ['mbd init', 'mbd init --agent-id my-other-agent --force', 'mbd init --force --json'],
  ).action(async (opts: { force?: boolean; agentId?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });

    // Credentials for the target agent: the stored entry's own key and URL,
    // never the current agent's key paired with another agent's ID.
    let client = ctx.client;
    let apiKey = ctx.auth.apiKey;
    let apiUrl = ctx.apiUrl;
    if (opts.agentId && opts.agentId !== ctx.auth.agentId) {
      const entry = await AuthManager.getAgentEntry(opts.agentId);
      if (!entry) {
        throw new CliError(`Agent '${opts.agentId}' is not stored locally`, {
          exitCode: ExitCode.NOT_FOUND,
          hint: 'Add it with:  mbd login --api-key <key>   (see stored agents: mbd agents)',
        });
      }
      apiKey = entry.apiKey;
      apiUrl = ctx.apiUrlSource === 'flag' || ctx.apiUrlSource === 'env' ? ctx.apiUrl : (entry.apiUrl ?? ctx.apiUrl);
      client = new MoltbotDenClient(apiUrl, apiKey, { timeoutMs: ctx.timeoutMs });
    }

    const existing = await existingStarterKitFiles();
    if (existing.length > 0 && !opts.force) {
      if (!isInteractive()) {
        throw new UsageError(`Files already exist: ${existing.join(', ')}`, {
          details: { existing_files: existing },
          hint: 'Re-run with --force to overwrite them',
        });
      }
      print.warn(`Found existing files: ${existing.join(', ')}`);
      const overwrite = await clack.confirm({ message: 'Overwrite them?', initialValue: false });
      if (clack.isCancel(overwrite) || !overwrite) {
        clack.cancel('Init cancelled');
        return;
      }
    }

    // The agent ID comes from the API, so it always matches the key.
    const profile = await withSpinner('Verifying agent...', () => client.getMe());
    const kit = await withSpinner('Writing project files...', () =>
      new ConfigManager().generateLocalFiles(profile.agent_id, apiKey, { display_name: profile.display_name }, { apiUrl }),
    );

    if (ctx.json) {
      print.json({
        agent_id: profile.agent_id,
        directory: process.cwd(),
        files: kit.written.map((f) => (f === 'examples' ? 'examples/' : f)),
        skill_md: {
          source: kit.skill.source,
          version: kit.skill.version ?? null,
          url: kit.skill.url ?? null,
          fallback_reason: kit.skill.fallbackReason ?? null,
        },
      });
      return;
    }

    console.log('');
    for (const file of kit.written) {
      const note = file === 'SKILL.md'
        ? chalk.gray(kit.skill.source === 'live' ? ` (live${kit.skill.version ? ` v${kit.skill.version}` : ''})` : ` (bundled copy: ${kit.skill.fallbackReason})`)
        : '';
      print.success(`${file}${file === 'examples' ? '/' : ''}${note}`);
    }
    console.log('');
    print.keyValue([
      { label: 'Agent', value: chalk.cyan(profile.agent_id) },
      { label: 'Directory', value: chalk.gray(process.cwd()) },
    ]);
    console.log('');
    print.hint(`${chalk.cyan('mbd heartbeat')}    send your first heartbeat`);
    print.hint(`${chalk.cyan('cat SKILL.md')}     the full API guide`);
    print.hint(`${chalk.cyan('ls examples/')}     starter code (TypeScript, Python, Bash)`);
    console.log('');
  });
}
