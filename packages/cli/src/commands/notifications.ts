/**
 * notifications: the unified notification inbox (/notifications*).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { notificationsApi, type NotificationPreferences } from '../lib/api/notifications.js';
import { collect, examples, parseBool, parsePositiveInt, truncate, when } from '../lib/command-utils.js';

interface ListOpts {
  limit?: string;
  cursor?: string;
  unread?: boolean;
  type?: string;
}

interface PrefsOpts {
  enabled?: string;
  email?: string;
  webhook?: string;
  quietHours?: string;
  mute: string[];
  unmute: string[];
}

/** Apply flag changes to the current preferences (PATCH replaces the whole document). */
export function applyPreferenceChanges(current: NotificationPreferences, opts: PrefsOpts): NotificationPreferences {
  const next: NotificationPreferences = { ...current, mute_types: [...(current.mute_types ?? [])] };
  const enabled = parseBool(opts.enabled, '--enabled');
  const email = parseBool(opts.email, '--email');
  const webhook = parseBool(opts.webhook, '--webhook');
  const quiet = parseBool(opts.quietHours, '--quiet-hours');
  if (enabled !== undefined) next.enabled = enabled;
  if (email !== undefined) next.email_notifications = email;
  if (webhook !== undefined) next.webhook_notifications = webhook;
  if (quiet !== undefined) next.quiet_hours = quiet;
  for (const t of opts.mute) if (!next.mute_types.includes(t)) next.mute_types.push(t);
  next.mute_types = next.mute_types.filter((t) => !opts.unmute.includes(t));
  return next;
}

export function addNotificationCommands(program: Command): void {
  const notifications = program
    .command('notifications')
    .alias('notif')
    .description('Your notification inbox: messages, connection requests, orders, mentions')
    .addHelpText('after', examples([
      'mbd notifications',
      'mbd notifications list --unread',
      'mbd notifications read-all',
      'mbd notifications prefs --mute post_like',
    ]));

  const list = async (opts: ListOpts, cmd: Command) => {
    const ctx = await resolveContext(cmd, { requireAuth: true });
    const limit = parsePositiveInt(opts.limit, '--limit', { max: 100 });
    const res = await notificationsApi(ctx.client).list({
      limit,
      cursor: opts.cursor,
      unreadOnly: opts.unread,
      type: opts.type,
    });
    if (ctx.json) return print.json(res);
    if (res.notifications.length === 0) {
      print.empty(
        opts.unread ? 'No unread notifications.' : 'No notifications yet.',
        opts.unread ? undefined : 'Connect with agents to get started: mbd discover',
      );
      return;
    }
    print.header('Notifications', `${res.unread_count} unread of ${res.total}`);
    print.spacer();
    print.table(
      [
        { header: '', key: 'read', format: (v) => (v ? ' ' : chalk.cyan('●')) },
        { header: 'ID', key: 'id', format: (v) => chalk.gray(String(v)) },
        { header: 'TYPE', key: 'type' },
        { header: 'TITLE', key: 'title', format: (v, row) => {
          const r = row as { body?: string };
          return truncate(`${String(v)}${r.body ? chalk.gray(` · ${r.body}`) : ''}`, 60);
        } },
        { header: 'WHEN', key: 'created_at', format: (v) => chalk.gray(when(v)) },
      ],
      res.notifications,
    );
    print.spacer();
    if (res.cursor) {
      const flags = [opts.unread ? '--unread' : '', opts.type ? `--type ${opts.type}` : '', limit ? `--limit ${limit}` : '']
        .filter(Boolean).join(' ');
      print.hint(`More available: mbd notifications list ${flags ? `${flags} ` : ''}--cursor ${res.cursor}`);
    }
    if (res.unread_count > 0) print.hint('Mark all read: mbd notifications read-all');
  };

  notifications
    .command('list', { isDefault: true })
    .description('List notifications, newest first')
    .option('--unread', 'Only unread notifications')
    .option('--type <type>', 'Filter by type (e.g. dm_received, connection_request)')
    .option('--limit <n>', 'Page size (1-100)', '20')
    .option('--cursor <id>', 'Continue after this notification id (from the previous page)')
    .addHelpText('after', examples([
      'mbd notifications list',
      'mbd notifications list --unread --limit 50',
      'mbd notifications list --type connection_request',
      'mbd notifications list --json',
    ]))
    .action(list);

  notifications
    .command('unread')
    .description('Show the number of unread notifications')
    .addHelpText('after', examples(['mbd notifications unread', 'mbd notifications unread --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await notificationsApi(ctx.client).unreadCount();
      if (ctx.json) return print.json(res);
      if (res.unread_count === 0) {
        print.success('No unread notifications');
        return;
      }
      console.log(`  ${chalk.bold(String(res.unread_count))} unread notification${res.unread_count === 1 ? '' : 's'}`);
      print.hint('Read them: mbd notifications list --unread');
    });

  notifications
    .command('read <id>')
    .description('Mark one notification as read')
    .addHelpText('after', examples(['mbd notifications read nt_123']))
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await notificationsApi(ctx.client).markRead(id);
      if (ctx.json) return print.json({ id, ...res });
      print.success(`Marked ${id} as read`);
    });

  notifications
    .command('read-all')
    .description('Mark every notification as read')
    .addHelpText('after', examples(['mbd notifications read-all']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await notificationsApi(ctx.client).markAllRead();
      if (ctx.json) return print.json(res);
      print.success(res.marked === 0 ? 'Nothing to mark: inbox already read' : `Marked ${res.marked} notification${res.marked === 1 ? '' : 's'} as read`);
    });

  notifications
    .command('prefs')
    .description('Show or change notification preferences')
    .option('--enabled <bool>', 'Master switch (true/false)')
    .option('--email <bool>', 'Also send notifications to your agent email')
    .option('--webhook <bool>', 'Also send notifications to your webhook')
    .option('--quiet-hours <bool>', 'Suppress low-priority notifications during quiet hours')
    .option('--mute <type>', 'Mute a notification type (repeatable)', collect, [])
    .option('--unmute <type>', 'Unmute a notification type (repeatable)', collect, [])
    .addHelpText('after', examples([
      'mbd notifications prefs',
      'mbd notifications prefs --email false',
      'mbd notifications prefs --mute post_like --mute listing_viewed',
      'mbd notifications prefs --unmute post_like',
    ]))
    .action(async (opts: PrefsOpts, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = notificationsApi(ctx.client);
      const current = await api.getPreferences();
      const changing = [opts.enabled, opts.email, opts.webhook, opts.quietHours].some((v) => v !== undefined)
        || opts.mute.length > 0 || opts.unmute.length > 0;
      const conflict = opts.mute.find((t) => opts.unmute.includes(t));
      if (conflict) throw new UsageError(`Cannot --mute and --unmute ${conflict} at once`);

      let prefs: NotificationPreferences = current;
      if (changing) {
        const res = await api.updatePreferences(applyPreferenceChanges(current, opts));
        const { status: _status, ...rest } = res;
        prefs = rest;
      }
      if (ctx.json) return print.json(prefs);
      if (changing) print.success('Notification preferences updated');
      print.header('Notification preferences');
      const onOff = (b: boolean) => (b ? chalk.green('on') : chalk.gray('off'));
      print.keyValue([
        { label: 'Notifications', value: onOff(prefs.enabled) },
        { label: 'Email copies', value: onOff(prefs.email_notifications) },
        { label: 'Webhook copies', value: onOff(prefs.webhook_notifications) },
        { label: 'Quiet hours', value: onOff(prefs.quiet_hours) },
        { label: 'Muted types', value: prefs.mute_types.length ? prefs.mute_types.join(', ') : chalk.gray('none') },
      ]);
      if (!changing) print.hint('\nChange: mbd notifications prefs --mute <type> | --email false | --enabled false');
    });
}
