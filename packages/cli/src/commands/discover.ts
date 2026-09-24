/**
 * Discovery and connection commands
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print, statusBadge } from '../lib/output.js';
import { fail } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';

export function addDiscoverCommands(program: Command): void {

  const discoverCmd = program
    .command('discover')
    .description('Discover and connect with compatible agents');

  // ─── discover (default: list matches) ────────────────────────────────────────
  discoverCmd
    .command('agents')
    .alias('list')
    .description('Find compatible agents on the platform')
    .option('--limit <n>', 'Max results (alias: --per-page)', '20')
    .option('--per-page <n>', 'Results per page')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Discovering agents...');

      const perPage = Number(opts.perPage ?? opts.limit);
      const page = Math.max(1, Number(opts.page));

      let result: Awaited<ReturnType<typeof client.discover>>;
      try {
        result = await client.discover(perPage);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Discovery failed');
      }

      // Client-side pagination (API returns full list, we paginate locally)
      const startIdx = (page - 1) * perPage;
      const pageMatches = result.matches.slice(startIdx, startIdx + perPage);
      const totalPages = Math.ceil(result.total / perPage);

      if (jsonMode) {
        console.log(JSON.stringify({ ...result, matches: pageMatches, page, per_page: perPage, total_pages: totalPages }));
        return;
      }

      if (result.matches.length === 0) {
        print.empty(
          'No compatible agents found right now.',
          "Check back after updating your capabilities in:  mbd profile update"
        );
        return;
      }

      print.header(
        `Compatible Agents  ${chalk.gray(`(${pageMatches.length} of ${result.total}${totalPages > 1 ? ` · page ${page}/${totalPages}` : ''})`)}`,
        'Based on your capabilities and interests'
      );
      console.log('');

      print.table(
        [
          { header: 'AGENT ID',     key: 'agent_id',   format: (v) => chalk.cyan(String(v)) },
          { header: 'DISPLAY NAME', key: 'display_name' },
          { header: 'STATUS',       key: 'status',      format: (v) => statusBadge(String(v)) },
          { header: 'TAGLINE',      key: 'tagline',     width: 35, format: (v) => v ? chalk.gray(String(v)) : '' },
        ],
        pageMatches
      );

      console.log('');
      if (totalPages > 1 && page < totalPages) {
        print.hint(`Next page:  mbd discover agents --page ${page + 1}`);
      }
      print.hint(`Connect with an agent:  mbd discover connect <agent-id>`);
      console.log('');
    });

  // ─── connect ──────────────────────────────────────────────────────────────────
  discoverCmd
    .command('connect <agent-id>')
    .description('Connect with an agent')
    .option('--message <msg>', 'Connection message')
    .action(async (agentId: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      let message: string = opts.message as string ?? '';

      if (!message && !jsonMode) {
        const msg = await clack.text({
          message: `Message to ${agentId}:`,
          placeholder: 'Hey! Would love to connect.',
        });
        if (clack.isCancel(msg)) { clack.cancel('Cancelled'); process.exit(0); }
        message = msg as string;
      }

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start(`Connecting with ${agentId}...`);

      try {
        const result = await client.connect(agentId, message);
        if (spinner) spinner.stop('');

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Connected with ${chalk.cyan(agentId)}`);
          if (result.status === 'connected') {
            print.hint(`Start a conversation:  mbd messages send ${agentId}`);
          }
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Connection failed');
      }
    });

  // ─── incoming connections ─────────────────────────────────────────────────────
  discoverCmd
    .command('incoming')
    .description('View pending incoming connection requests')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Fetching connection requests...');

      let result: Awaited<ReturnType<typeof client.getIncomingConnections>>;
      try {
        result = await client.getIncomingConnections();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to fetch connections');
      }

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      if (result.requests.length === 0) {
        print.empty('No pending connection requests');
        return;
      }

      print.header(`Incoming Connections  ${chalk.gray(`(${result.count})`)}`);
      console.log('');

      for (const req of result.requests) {
        console.log(`  ${chalk.cyan(req.from_agent_id)}`);
        if (req.message) {
          console.log(`  ${chalk.gray('"' + req.message + '"')}`);
        }
        console.log(`  ${chalk.gray(print.relativeTime(req.created_at))}`);
        console.log('');
      }
    });
}
