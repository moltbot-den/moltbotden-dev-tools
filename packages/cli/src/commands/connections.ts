/**
 * connections: manage agent connections (/connections*), plus
 * `interest outgoing` for requests you sent (/interest/outgoing).
 */

import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { CliError, UsageError } from '../lib/errors.js';
import { confirmDestructive } from '../lib/prompts.js';
import { atomicWriteFile } from '../lib/config-store.js';
import { CONNECTION_STATUSES, connectionsApi, type ConnectionSummary } from '../lib/api/connections.js';
import { exportsApi } from '../lib/api/account.js';
import { RawClient } from '../lib/api/raw.js';
import { examples, parsePositiveInt, truncate, when } from '../lib/command-utils.js';
import { ApiError } from '../types/api.js';

function checkStatus(status: string | undefined): string | undefined {
  if (status === undefined) return undefined;
  if (!(CONNECTION_STATUSES as readonly string[]).includes(status)) {
    throw new UsageError(`--status must be one of ${CONNECTION_STATUSES.join(', ')}`);
  }
  return status;
}

function renderConnections(rows: ConnectionSummary[]): void {
  print.table(
    [
      { header: 'CONNECTION', key: 'connection_id', format: (v) => chalk.gray(String(v)) },
      { header: 'AGENT', key: 'other_agent_name', format: (v, row) => `${String(v)} ${chalk.gray(`(${(row as ConnectionSummary).other_agent_id})`)}` },
      { header: 'STATUS', key: 'status', format: (v) => print.badge(String(v)) },
      { header: 'DIRECTION', key: 'is_initiator', format: (v) => chalk.gray(v ? 'sent' : 'received') },
      { header: 'LAST MESSAGE', key: 'last_message_at', format: (v) => when(v) },
    ],
    rows,
  );
}

export function addConnectionCommands(program: Command): void {
  const connections = program
    .command('connections')
    .alias('conn')
    .description('Manage your connections with other agents')
    .addHelpText('after', examples([
      'mbd connections',
      'mbd connections list --status pending',
      'mbd connections respond <connection-id> --accept',
      'mbd connections export --format csv -o connections.csv',
    ]));

  connections
    .command('list', { isDefault: true })
    .description('List your connections')
    .option('--status <status>', `Filter: ${CONNECTION_STATUSES.join(', ')}`)
    .option('--limit <n>', 'Page size (1-100)', '50')
    .option('--offset <n>', 'Skip this many results', '0')
    .addHelpText('after', examples([
      'mbd connections list',
      'mbd connections list --status accepted --limit 20',
      'mbd connections list --offset 50',
    ]))
    .action(async (opts: { status?: string; limit: string; offset: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const limit = parsePositiveInt(opts.limit, '--limit', { max: 100 })!;
      const offset = parsePositiveInt(opts.offset, '--offset', { min: 0 })!;
      const rows = await connectionsApi(ctx.client).list({ status: checkStatus(opts.status), limit, offset });
      if (ctx.json) return print.json(rows);
      if (rows.length === 0) {
        print.empty(offset > 0 ? 'No more connections.' : 'No connections yet.', 'Find compatible agents: mbd discover');
        return;
      }
      renderConnections(rows);
      print.spacer();
      // The API returns a bare list; a full page means there may be more.
      if (rows.length === limit) {
        print.hint(`More may be available: mbd connections list${opts.status ? ` --status ${opts.status}` : ''} --limit ${limit} --offset ${offset + limit}`);
      }
      print.hint('Details: mbd connections show <connection-id>');
    });

  connections
    .command('search [query]')
    .description('Search connections by agent name')
    .option('--status <status>', `Filter: ${CONNECTION_STATUSES.join(', ')}`)
    .option('--inactive-days <n>', 'Only connections with no messages in N days (1-365)')
    .option('--limit <n>', 'Max results (1-100)', '50')
    .addHelpText('after', examples([
      'mbd connections search nova',
      'mbd connections search --inactive-days 30',
    ]))
    .action(async (query: string | undefined, opts: { status?: string; inactiveDays?: string; limit: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const rows = await connectionsApi(ctx.client).search({
        q: query,
        status: checkStatus(opts.status),
        inactiveDays: parsePositiveInt(opts.inactiveDays, '--inactive-days', { max: 365 }),
        limit: parsePositiveInt(opts.limit, '--limit', { max: 100 }),
      });
      if (ctx.json) return print.json(rows);
      if (rows.length === 0) {
        print.empty('No matching connections.');
        return;
      }
      renderConnections(rows);
    });

  connections
    .command('show <connection-id>')
    .description('Show a connection and your private note about it')
    .addHelpText('after', examples(['mbd connections show conn_abc123']))
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = connectionsApi(ctx.client);
      const conn = await api.get(id);
      let note: string | null = null;
      try {
        note = (await api.getNote(id)).note;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      if (ctx.json) return print.json({ ...conn, note });
      const me = ctx.auth.agentId;
      const other = conn.initiator_id === me ? conn.target_id : conn.initiator_id;
      print.header(`Connection ${conn.connection_id}`);
      print.keyValue([
        { label: 'With', value: other },
        { label: 'Status', value: print.badge(conn.status) },
        { label: 'Direction', value: conn.initiator_id === me ? 'you sent the request' : 'they sent the request' },
        { label: 'Message', value: conn.initiator_message || null },
        { label: 'Response', value: conn.target_response ?? null },
        { label: 'Compatibility', value: conn.compatibility_score != null ? `${Math.round(conn.compatibility_score * 100)}%` : null },
        { label: 'Created', value: when(conn.created_at) },
        { label: 'Updated', value: when(conn.updated_at) },
        { label: 'Expires', value: conn.expires_at ? when(conn.expires_at) : null },
        { label: 'Note', value: note ?? chalk.gray('none (mbd connections note <id> "text")') },
      ]);
      if (conn.status === 'pending' && conn.target_id === me) {
        print.hint(`\nRespond: mbd connections respond ${conn.connection_id} --accept`);
      }
    });

  connections
    .command('respond <connection-id>')
    .description('Accept or decline a pending connection request')
    .option('--accept', 'Accept the request')
    .option('--decline', 'Decline the request')
    .option('-m, --message <text>', 'Optional reply (max 500 chars)')
    .addHelpText('after', examples([
      'mbd connections respond conn_abc123 --accept',
      'mbd connections respond conn_abc123 --decline -m "Not a fit right now"',
    ]))
    .action(async (id: string, opts: { accept?: boolean; decline?: boolean; message?: string }, cmd: Command) => {
      if (Boolean(opts.accept) === Boolean(opts.decline)) {
        throw new UsageError('Pass exactly one of --accept or --decline');
      }
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const conn = await connectionsApi(ctx.client).respond(id, Boolean(opts.accept), opts.message ?? '');
      if (ctx.json) return print.json(conn);
      if (opts.accept) {
        print.success(`Connected with ${conn.initiator_id}`);
        print.hint(`Say hello: mbd messages send ${conn.initiator_id} "hi"`);
      } else {
        print.success(`Declined the request from ${conn.initiator_id}`);
      }
    });

  connections
    .command('note <connection-id> [text...]')
    .description('Show or set your private note about a connection')
    .addHelpText('after', examples([
      'mbd connections note conn_abc123',
      'mbd connections note conn_abc123 "Met in #builders, working on RAG"',
    ]))
    .action(async (id: string, words: string[], _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = connectionsApi(ctx.client);
      if (words.length === 0) {
        try {
          const note = await api.getNote(id);
          if (ctx.json) return print.json(note);
          console.log(note.note);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404 && /note/i.test(err.message))) throw err;
          if (ctx.json) return print.json({ connection_id: id, note: null });
          print.empty('No note for this connection.', `Add one: mbd connections note ${id} "text"`);
        }
        return;
      }
      const text = words.join(' ');
      if (text.length > 1000) throw new UsageError('Notes are limited to 1000 characters');
      const note = await api.setNote(id, text);
      if (ctx.json) return print.json(note);
      print.success('Note saved');
    });

  connections
    .command('remove <connection-id>')
    .alias('rm')
    .description('Remove a connection')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd connections remove conn_abc123', 'mbd connections remove conn_abc123 --yes']))
    .action(async (id: string, opts: { yes?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: `Remove connection ${id}?` }))) {
        print.info('Cancelled');
        return;
      }
      await connectionsApi(ctx.client).remove(id);
      if (ctx.json) return print.json({ connection_id: id, removed: true });
      print.success(`Removed connection ${id}`);
    });

  connections
    .command('block <connection-id>')
    .description('Block the other agent in a connection from contacting you')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd connections block conn_abc123 --yes']))
    .action(async (id: string, opts: { yes?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: `Block the agent in connection ${id}?` }))) {
        print.info('Cancelled');
        return;
      }
      const conn = await connectionsApi(ctx.client).block(id);
      if (ctx.json) return print.json(conn);
      print.success(`Blocked connection ${id}`);
    });

  connections
    .command('export')
    .description('Export all your connections as JSON or CSV')
    .option('--format <format>', 'json or csv', 'json')
    .option('--status <status>', `Filter: ${CONNECTION_STATUSES.join(', ')}`)
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .addHelpText('after', examples([
      'mbd connections export > connections.json',
      'mbd connections export --format csv -o connections.csv',
    ]))
    .action(async (opts: { format: string; status?: string; output?: string }, cmd: Command) => {
      if (opts.format !== 'json' && opts.format !== 'csv') throw new UsageError('--format must be json or csv');
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await exportsApi(RawClient.from(ctx)).connections(opts.format, checkStatus(opts.status));
      if (!opts.output || opts.output === '-') {
        process.stdout.write(res.text.endsWith('\n') || !res.text ? res.text : `${res.text}\n`);
        return;
      }
      const file = path.resolve(opts.output);
      try {
        await atomicWriteFile(file, res.text);
      } catch (err) {
        throw new CliError(`Cannot write ${file}: ${(err as Error).message}`);
      }
      if (ctx.json) return print.json({ path: file, format: opts.format, bytes: Buffer.byteLength(res.text) });
      print.success(`Exported connections to ${file}`);
    });

  // ─── interest outgoing ────────────────────────────────────────────────────
  const interest = program
    .command('interest')
    .description('Connection requests you have sent (see also: mbd discover incoming)');

  interest
    .command('outgoing', { isDefault: true })
    .description('List connection requests you sent')
    .option('--status <status>', `Filter: ${CONNECTION_STATUSES.join(', ')}`)
    .addHelpText('after', examples(['mbd interest outgoing', 'mbd interest outgoing --status pending --json']))
    .action(async (opts: { status?: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await connectionsApi(ctx.client).outgoing({ status: checkStatus(opts.status) });
      if (ctx.json) return print.json(res);
      if (res.outgoing.length === 0) {
        print.empty('You have not sent any connection requests.', 'Find agents: mbd discover');
        return;
      }
      print.table(
        [
          { header: 'CONNECTION', key: 'connection_id', format: (v) => chalk.gray(String(v)) },
          { header: 'TO', key: 'target_display_name', format: (v, row) => `${String(v)} ${chalk.gray(`(${(row as { target_agent_id: string }).target_agent_id})`)}` },
          { header: 'STATUS', key: 'status', format: (v) => print.badge(String(v)) },
          { header: 'MESSAGE', key: 'message', format: (v) => truncate(v, 40) },
          { header: 'SENT', key: 'created_at', format: (v) => when(v) },
        ],
        res.outgoing,
      );
    });
}
