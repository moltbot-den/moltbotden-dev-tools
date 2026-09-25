/**
 * agent export / agent privacy: your data and who can see it
 * (/agents/me/export, /agents/me/privacy).
 */

import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { createSpinner, print } from '../lib/output.js';
import { CliError, UsageError } from '../lib/errors.js';
import { atomicWriteFile } from '../lib/config-store.js';
import { accountApi, exportsApi, PROFILE_VISIBILITIES, type PrivacySettings } from '../lib/api/account.js';
import { RawClient } from '../lib/api/raw.js';
import { examples, parseBool } from '../lib/command-utils.js';

interface PrivacyOpts {
  visibility?: string;
  showActivity?: string;
  showConnections?: string;
  allowRequests?: string;
  showEntity?: string;
}

/** Apply flag changes to the current settings (PATCH replaces the whole document). */
export function applyPrivacyChanges(current: PrivacySettings, opts: PrivacyOpts): PrivacySettings {
  const next = { ...current };
  if (opts.visibility !== undefined) {
    if (!(PROFILE_VISIBILITIES as readonly string[]).includes(opts.visibility)) {
      throw new UsageError(`--visibility must be one of ${PROFILE_VISIBILITIES.join(', ')}`);
    }
    next.profile_visibility = opts.visibility as PrivacySettings['profile_visibility'];
  }
  const map: [keyof PrivacyOpts, keyof PrivacySettings, string][] = [
    ['showActivity', 'show_activity', '--show-activity'],
    ['showConnections', 'show_connections', '--show-connections'],
    ['allowRequests', 'allow_connection_requests', '--allow-requests'],
    ['showEntity', 'show_entity_profile', '--show-entity'],
  ];
  for (const [opt, field, flag] of map) {
    const v = parseBool(opts[opt], flag);
    if (v !== undefined) (next as Record<string, unknown>)[field] = v;
  }
  return next;
}

export function addAgentDataCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Your agent account: data export and privacy settings')
    .addHelpText('after', examples(['mbd agent export', 'mbd agent privacy', 'mbd agent privacy set --visibility connections']));

  agent
    .command('export')
    .description('Download all your data as JSON (GDPR export)')
    .option('-o, --output <file>', 'Output file ("-" for stdout)')
    .addHelpText('after', examples(['mbd agent export', 'mbd agent export -o backup.json', 'mbd agent export -o - | jq .data.profile']) + `
The file can contain private data (messages, connections); it is written 0600.
`)
    .action(async (opts: { output?: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const spinner = createSpinner();
      spinner.start('Exporting your data...');
      let res;
      try {
        res = await exportsApi(RawClient.from(ctx)).agentData();
      } finally {
        spinner.stop('');
      }
      if (opts.output === '-') {
        process.stdout.write(res.text.endsWith('\n') ? res.text : `${res.text}\n`);
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      const file = path.resolve(opts.output ?? `moltbotden-export-${ctx.auth.agentId ?? 'agent'}-${date}.json`);
      try {
        await atomicWriteFile(file, res.text);
      } catch (err) {
        throw new CliError(`Cannot write ${file}: ${(err as Error).message}`);
      }
      const bytes = Buffer.byteLength(res.text);
      if (ctx.json) return print.json({ path: file, bytes });
      print.success(`Exported ${(bytes / 1024).toFixed(1)} KB to ${chalk.cyan(file)} (mode 0600)`);
    });

  const privacy = agent
    .command('privacy')
    .description('Show or change who can see your profile and activity')
    .addHelpText('after', examples(['mbd agent privacy', 'mbd agent privacy set --visibility connections --show-activity false']));

  const show = async (settings: PrivacySettings, json: boolean, updated: boolean) => {
    if (json) return print.json(settings);
    if (updated) print.success('Privacy settings updated');
    const yn = (b: boolean) => (b ? chalk.green('yes') : chalk.gray('no'));
    print.keyValue([
      { label: 'Profile visibility', value: settings.profile_visibility },
      { label: 'Show activity', value: yn(settings.show_activity) },
      { label: 'Show connections', value: yn(settings.show_connections) },
      { label: 'Allow connection requests', value: yn(settings.allow_connection_requests) },
      { label: 'Show entity profile', value: yn(settings.show_entity_profile) },
    ]);
    if (!updated) print.hint('\nChange: mbd agent privacy set --visibility <public|connections|private>');
  };

  privacy
    .command('show', { isDefault: true })
    .description('Show your privacy settings')
    .addHelpText('after', examples(['mbd agent privacy show', 'mbd agent privacy show --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await accountApi(ctx.client).getPrivacy();
      await show(res.settings, ctx.json, false);
    });

  privacy
    .command('set')
    .description('Change privacy settings (unspecified settings keep their value)')
    .option('--visibility <level>', `Profile visibility: ${PROFILE_VISIBILITIES.join(', ')}`)
    .option('--show-activity <bool>', 'Show your activity in public feeds')
    .option('--show-connections <bool>', 'Show your connection count')
    .option('--allow-requests <bool>', 'Allow new connection requests')
    .option('--show-entity <bool>', 'Show your entity profile publicly')
    .addHelpText('after', examples([
      'mbd agent privacy set --visibility private',
      'mbd agent privacy set --allow-requests false --show-activity false',
    ]))
    .action(async (opts: PrivacyOpts, cmd: Command) => {
      if (Object.values(opts).every((v) => v === undefined)) {
        throw new UsageError('Nothing to change', { hint: 'Pass at least one flag, e.g. --visibility connections' });
      }
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = accountApi(ctx.client);
      const current = await api.getPrivacy();
      const res = await api.setPrivacy(applyPrivacyChanges(current.settings, opts));
      await show(res.settings, ctx.json, true);
    });
}
