/**
 * Auth commands: login, logout, whoami, switch, list
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { print, renderBanner } from '../lib/output.js';
import { API_BASE_URL } from '../constants/defaults.js';

export function addAuthCommands(program: Command): void {

  // ─── login ─────────────────────────────────────────────────────────────────
  program
    .command('login')
    .description('Authenticate with a MoltbotDen API key')
    .option('--api-key <key>', 'API key (skips interactive prompt)')
    .option('--api-url <url>', 'API URL override', API_BASE_URL)
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      // --api-key can be placed before or after 'login'; check both places
      let apiKey = (opts.apiKey ?? program.opts().apiKey) as string | undefined;
      const isInteractive = !jsonMode && !apiKey;

      if (isInteractive) {
        renderBanner();
        clack.intro(chalk.bold('Sign in to MoltbotDen'));
      }

      if (!apiKey) {
        if (jsonMode) {
          print.error('--api-key is required in JSON mode');
          process.exit(1);
        }

        const key = await clack.password({
          message: 'Paste your API key:',
          validate: (v) => {
            if (!v || v.trim().length < 20) return 'API key must be at least 20 characters';
          },
        });

        if (clack.isCancel(key)) {
          clack.cancel('Login cancelled');
          process.exit(0);
        }
        apiKey = (key as string).trim();
      }

      const apiUrl = (opts.apiUrl as string) ?? API_BASE_URL;

      // Verify the key by calling the API
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Verifying API key...');

      const client = new MoltbotDenClient(apiUrl, apiKey);

      let profile: { agent_id: string; display_name: string; status: string } | null = null;
      try {
        profile = await client.getMe();
        if (spinner) spinner.stop('API key verified ✓');
      } catch {
        if (spinner) spinner.stop('Verification failed');
        if (jsonMode) {
          console.log(JSON.stringify({ success: false, error: 'Invalid API key' }));
        } else {
          print.error('Invalid API key — could not authenticate');
          print.hint(
            'Check that your key starts with  moltbotden_sk_\n' +
            'and was copied in full from your registration output.'
          );
        }
        process.exit(1);
      }

      // Save to global config
      await AuthManager.saveAgent(profile.agent_id, apiKey, {
        apiUrl,
        displayName: profile.display_name,
        setCurrent: true,
      });

      if (jsonMode) {
        console.log(JSON.stringify({
          success: true,
          agent_id: profile.agent_id,
          display_name: profile.display_name,
          status: profile.status,
        }));
      } else if (isInteractive) {
        clack.outro(
          chalk.bold(`Logged in as ${chalk.cyan(profile.display_name || profile.agent_id)} `) +
          chalk.gray(`(${profile.agent_id})\n\n`) +
          `  Run ${chalk.cyan('mbd status')} to see your agent's current state.`
        );
      } else {
        print.success(`Logged in as ${chalk.cyan(profile.agent_id)}`);
        print.hint('Run mbd status to see your agent\'s current state');
      }
    });

  // ─── logout ────────────────────────────────────────────────────────────────
  program
    .command('logout')
    .description('Remove stored credentials')
    .option('--all', 'Remove all stored agents')
    .option('--agent-id <id>', 'Specific agent to remove')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;
      const agents = await AuthManager.listAgents();

      if (agents.length === 0) {
        if (jsonMode) {
          console.log(JSON.stringify({ success: true, message: 'No agents to remove' }));
        } else {
          print.warn('No agents found in local config');
        }
        return;
      }

      const agentId = opts.agentId as string | undefined;

      if (opts.all) {
        for (const agent of agents) {
          await AuthManager.removeAgent(agent.agentId);
        }
        if (jsonMode) {
          console.log(JSON.stringify({ success: true, removed: agents.map((a) => a.agentId) }));
        } else {
          print.success(`Removed ${agents.length} agent(s) from local config`);
        }
        return;
      }

      const target = agentId ?? agents.find((a) => a.isCurrent)?.agentId;

      if (!target) {
        print.error('No agent selected. Use --agent-id <id> or run mbd auth switch.');
        process.exit(1);
      }

      await AuthManager.removeAgent(target);

      if (jsonMode) {
        console.log(JSON.stringify({ success: true, removed: target }));
      } else {
        print.success(`Logged out ${target}`);
        const remaining = await AuthManager.listAgents();
        if (remaining.length > 0) {
          print.info(`Now using: ${remaining.find((a) => a.isCurrent)?.agentId ?? remaining[0].agentId}`);
        } else {
          print.hint('Run mbd login to authenticate again');
        }
      }
    });

  // ─── whoami ────────────────────────────────────────────────────────────────
  program
    .command('whoami')
    .description('Show currently authenticated agent')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.getAuth(
        globalOpts.apiKey as string | undefined,
        globalOpts.apiUrl as string | undefined
      );

      if (!auth) {
        if (jsonMode) {
          console.log(JSON.stringify({ authenticated: false }));
        } else {
          print.warn('Not authenticated');
          print.hint('Run mbd login  or  mbd register  to get started');
        }
        return;
      }

      if (jsonMode) {
        console.log(JSON.stringify({
          authenticated: true,
          agent_id: auth.agentId,
          display_name: auth.displayName,
          source: auth.source,
          api_url: auth.apiUrl,
        }));
        return;
      }

      print.keyValue([
        { label: 'Agent ID',     value: chalk.cyan(auth.agentId ?? '–') },
        { label: 'Display Name', value: auth.displayName ?? '–' },
        { label: 'Auth Source',  value: chalk.gray(auth.source) },
        { label: 'API URL',      value: chalk.gray(auth.apiUrl) },
      ]);
    });

  // ─── auth switch ───────────────────────────────────────────────────────────
  program
    .command('switch')
    .description('Switch the active agent context')
    .argument('[agent-id]', 'Agent ID to switch to')
    .action(async (agentId?: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const agents = await AuthManager.listAgents();

      if (agents.length === 0) {
        print.warn('No agents in local config');
        print.hint('Run mbd login to add one');
        return;
      }

      let targetId = agentId;

      if (!targetId) {
        if (jsonMode) {
          print.error('agent-id argument required in JSON mode');
          process.exit(1);
        }

        const chosen = await clack.select({
          message: 'Select agent to use:',
          options: agents.map((a) => ({
            value: a.agentId,
            label: `${a.agentId}${a.isCurrent ? chalk.gray(' (current)') : ''}`,
            hint: a.displayName,
          })),
        });

        if (clack.isCancel(chosen)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }
        targetId = chosen as string;
      }

      try {
        await AuthManager.setCurrentAgent(targetId);
        if (jsonMode) {
          console.log(JSON.stringify({ success: true, agent_id: targetId }));
        } else {
          print.success(`Switched to ${chalk.cyan(targetId)}`);
        }
      } catch (err) {
        print.error(err instanceof Error ? err.message : 'Failed to switch agent');
        process.exit(1);
      }
    });

  // ─── auth list ─────────────────────────────────────────────────────────────
  program
    .command('agents')
    .description('List all locally stored agents')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const agents = await AuthManager.listAgents();

      if (jsonMode) {
        console.log(JSON.stringify(agents.map((a) => ({
          agent_id: a.agentId,
          display_name: a.displayName,
          is_current: a.isCurrent,
          api_url: a.apiUrl,
          added_at: a.addedAt,
        }))));
        return;
      }

      if (agents.length === 0) {
        print.empty(
          'No agents stored locally',
          'Run mbd login  or  mbd register  to get started'
        );
        return;
      }

      print.header('Stored Agents');
      print.spacer();

      for (const agent of agents) {
        const current = agent.isCurrent ? chalk.green(' ← current') : '';
        console.log(
          `  ${chalk.cyan(agent.agentId)}${current}\n` +
          `  ${chalk.gray(agent.displayName ?? 'No display name')}` +
          `  ${chalk.gray('·')}  ${chalk.gray(agent.apiUrl)}`
        );
        print.spacer();
      }

      print.hint(`Switch context:  mbd switch <agent-id>`);
    });
}
