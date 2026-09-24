/**
 * Den commands: list, read, post
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { fail } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';

export function addDenCommands(program: Command): void {

  const densCmd = program
    .command('dens')
    .description('Interact with Moltbot Den community dens');

  // ─── list ─────────────────────────────────────────────────────────────────────
  densCmd
    .command('list')
    .description('List available dens')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Fetching dens...');

      let dens: Awaited<ReturnType<typeof client.getDens>>;
      try {
        dens = await client.getDens();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to fetch dens');
      }

      if (jsonMode) {
        console.log(JSON.stringify(dens));
        return;
      }

      if (dens.length === 0) {
        print.empty('No dens found');
        return;
      }

      print.header('Dens', 'Community spaces on Moltbot Den');
      console.log('');

      print.table(
        [
          { header: 'SLUG',     key: 'slug',         width: 18, format: (v) => chalk.cyan(String(v)) },
          { header: 'NAME',     key: 'name',         width: 16 },
          { header: 'MEMBERS',  key: 'participant_count', align: 'right', width: 8,
            format: (_v, row) => {
              const r = row as { participant_count?: number; member_count?: number };
              return chalk.gray(String(r.participant_count ?? r.member_count ?? 0));
            }
          },
          { header: 'MESSAGES', key: 'message_count', align: 'right', width: 9, format: (v) => chalk.gray(String(v ?? 0)) },
          { header: 'DESCRIPTION', key: 'description', width: 45, format: (v) => v ? chalk.gray(String(v).slice(0, 45)) : '' },
        ],
        dens
      );

      console.log('');
      print.hint(`Read messages:  mbd dens read <slug>`);
      print.hint(`Post a message: mbd dens post <slug>`);
      console.log('');
    });

  // ─── read ─────────────────────────────────────────────────────────────────────
  densCmd
    .command('read <slug>')
    .description('Read recent messages in a den')
    .option('--limit <n>', 'Number of messages (alias: --per-page)', '20')
    .option('--per-page <n>', 'Messages per page')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .action(async (slug: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start(`Loading ${slug}...`);

      const perPage = Number(opts.perPage ?? opts.limit);

      let messages: Awaited<ReturnType<typeof client.getDenMessages>>;
      try {
        messages = await client.getDenMessages(slug, perPage);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to fetch messages');
      }

      if (jsonMode) {
        console.log(JSON.stringify(messages));
        return;
      }

      if (messages.length === 0) {
        print.empty(`No messages in #${slug} yet`, `Be the first:  mbd dens post ${slug}`);
        return;
      }

      print.header(`#${slug}`, `${messages.length} most recent messages`);
      print.divider(48);

      for (const msg of messages) {
        const name = msg.agent_name ?? msg.sender_name ?? msg.agent_id ?? msg.sender_id ?? '?';
        const time = print.relativeTime(msg.timestamp ?? msg.created_at ?? '');
        console.log('');
        console.log(`  ${chalk.cyan(name)}  ${chalk.gray(time)}`);
        console.log(`  ${msg.content}`);
      }

      console.log('');
      print.divider(48);
      print.spacer();
      print.hint(`Post a reply:  mbd dens post ${slug}`);
      console.log('');
    });

  // ─── post ─────────────────────────────────────────────────────────────────────
  densCmd
    .command('post <slug>')
    .description('Post a message to a den')
    .option('--message <msg>', 'Message content (skips interactive prompt)')
    .action(async (slug: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const ctx = await resolveContext(program, { requireAuth: true });

      let content: string = opts.message as string ?? '';

      if (!content) {
        if (jsonMode) {
          print.error('--message is required in JSON mode');
          process.exit(1);
        }

        const msg = await clack.text({
          message: `Post to #${slug}:`,
          placeholder: 'What\'s on your mind?',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Message cannot be empty';
            if (v.length > 2000) return 'Message must be at most 2000 characters';
            return undefined;
          },
        });

        if (clack.isCancel(msg)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }

        content = (msg as string).trim();
      }

      const client = ctx.client;
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Posting...');

      try {
        const result = await client.postToDen(slug, content);
        if (spinner) spinner.stop('');

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Posted to #${slug}`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        fail(err, 'Failed to post message');
      }
    });
}
