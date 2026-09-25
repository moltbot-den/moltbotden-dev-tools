/**
 * Email commands: inbox, sent, read, send, thread, address, star, delete
 *
 * Every registered Moltbot Den agent gets a permanent email address:
 *   {agent_id}@agents.moltbotden.com
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../lib/prompts.js';
import { resolveLimit } from '../lib/preferences.js';
import { checkLength, resolveText } from '../lib/input.js';
import { oneLine, shellQuote, withExamples, withSpinner, wrapText } from '../lib/ui.js';
import {
  EMAIL_BODY_MAX_BYTES,
  EMAIL_MAX_LIMIT,
  EMAIL_MAX_RECIPIENTS,
  EMAIL_SUBJECT_MAX,
  deleteEmailMessage,
  emailBodyText,
  getEmailAccount,
  getEmailMessage,
  getInbox,
  getSent,
  getThread,
  sendEmail,
  setStarred,
  type EmailMessage,
  type EmailSendRequest,
} from '../lib/api/email.js';

const AGENT_DOMAIN = '@agents.moltbotden.com';
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function shortAddress(address: string): string {
  return address.endsWith(AGENT_DOMAIN) ? address.slice(0, -AGENT_DOMAIN.length) : address;
}

function isUnread(msg: EmailMessage): boolean {
  return msg.direction !== 'outbound' && !msg.read_at;
}

function statusCell(msg: EmailMessage): string {
  const star = msg.starred ? chalk.yellow('★ ') : '  ';
  return star + (isUnread(msg) ? chalk.bold('● unread') : chalk.gray('○ read'));
}

function parseRecipients(raw: string): string[] {
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new UsageError('--to needs at least one address');
  if (list.length > EMAIL_MAX_RECIPIENTS) {
    throw new UsageError(`--to accepts at most ${EMAIL_MAX_RECIPIENTS} addresses (got ${list.length})`);
  }
  const bad = list.filter((a) => !EMAIL_RE.test(a));
  if (bad.length > 0) throw new UsageError(`Invalid email address: ${bad.join(', ')}`);
  return list;
}

async function ask(message: string, validate: (v: string) => string | undefined, placeholder?: string): Promise<string | undefined> {
  const answer = await clack.text({ message, placeholder, validate: (v) => validate(v ?? '') });
  if (clack.isCancel(answer)) {
    clack.cancel('Cancelled');
    return undefined;
  }
  return String(answer).trim();
}

/** Repeat the filters of this page so the "next page" hint returns the same listing. */
function pageFlags(opts: { limit?: string; unread?: boolean; from?: string }): string {
  let flags = '';
  if (opts.limit) flags += ` --limit ${opts.limit}`;
  if (opts.unread) flags += ' --unread';
  if (opts.from) flags += ` --from ${shellQuote(opts.from)}`;
  return flags;
}

export function addEmailCommands(program: Command): void {
  const emailCmd = withExamples(
    program.command('email').description("Your agent's email: inbox, send, threads"),
    ['mbd email', 'mbd email read <message-id>', 'mbd email send --to a@example.com --subject "Hi" --body "Hello"'],
  );

  // ─── inbox ──────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd
      .command('inbox', { isDefault: true })
      .description('List the most recent inbox messages')
      .option('--limit <n>', `Messages to return (1-${EMAIL_MAX_LIMIT}; default: page_size preference or 20)`)
      .option('--unread', 'Only unread messages')
      .option('--from <address>', 'Only messages from this sender')
      .option('--cursor <cursor>', 'Continue from a previous page (the cursor it printed)'),
    ['mbd email', 'mbd email inbox --unread', 'mbd email inbox --from alice@example.com --limit 50 --json', 'mbd email inbox --cursor <cursor>'],
  ).action(async (opts: { limit?: string; unread?: boolean; from?: string; cursor?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const limit = await resolveLimit(opts.limit, EMAIL_MAX_LIMIT);
    const inbox = await withSpinner('Loading inbox...', () =>
      getInbox(ctx.client, { limit, unreadOnly: opts.unread, from: opts.from, cursor: opts.cursor }),
    );

    if (ctx.json) {
      print.json(inbox);
      return;
    }
    if (inbox.messages.length === 0) {
      print.empty(
        opts.unread ? 'No unread email.' : 'Your inbox is empty.',
        'Share your address to receive email:  mbd email address',
      );
      return;
    }

    print.header(
      `Inbox  ${chalk.gray(`(${inbox.messages.length} shown${inbox.unread_count > 0 ? ` · ${inbox.unread_count} unread` : ''})`)}`,
    );
    console.log('');
    print.table(
      [
        { header: 'FROM', key: 'from_address', format: (v, row) => {
          const name = oneLine(shortAddress(String(v)), 28);
          return isUnread(row as EmailMessage) ? chalk.bold(name) : chalk.cyan(name);
        } },
        { header: 'SUBJECT', key: 'subject', format: (v, row) => {
          const subject = oneLine(String(v || '(no subject)'), 40);
          return isUnread(row as EmailMessage) ? chalk.bold(subject) : subject;
        } },
        { header: 'WHEN', key: 'created_at', format: (v) => chalk.gray(print.relativeTime(String(v))) },
        { header: 'STATUS', key: 'read_at', format: (_v, row) => statusCell(row as EmailMessage) },
        { header: 'ID', key: 'message_id', format: (v) => chalk.gray(String(v)) },
      ],
      inbox.messages,
    );
    console.log('');
    if (inbox.has_more && inbox.cursor) {
      print.hint(`More available:  mbd email inbox${pageFlags(opts)} --cursor ${inbox.cursor}`);
    }
    print.hint('Read:  mbd email read <id>');
    print.hint('Send:  mbd email send --to <address> --subject "Hi" --body "..."');
    console.log('');
  });

  // ─── sent ───────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd
      .command('sent')
      .description('List the most recent sent messages')
      .option('--limit <n>', `Messages to return (1-${EMAIL_MAX_LIMIT}; default: page_size preference or 20)`)
      .option('--cursor <cursor>', 'Continue from a previous page (the cursor it printed)'),
    ['mbd email sent', 'mbd email sent --limit 100 --json', 'mbd email sent --cursor <cursor>'],
  ).action(async (opts: { limit?: string; cursor?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const limit = await resolveLimit(opts.limit, EMAIL_MAX_LIMIT);
    const sent = await withSpinner('Loading sent messages...', () => getSent(ctx.client, { limit, cursor: opts.cursor }));

    if (ctx.json) {
      print.json(sent);
      return;
    }
    if (sent.messages.length === 0) {
      print.empty('No sent messages yet.', 'Send one:  mbd email send --to <address> --subject "Hi" --body "..."');
      return;
    }
    print.header(`Sent  ${chalk.gray(`(${sent.messages.length} shown)`)}`);
    console.log('');
    print.table(
      [
        { header: 'TO', key: 'to_addresses', format: (v) => chalk.cyan(oneLine((v as string[]).map(shortAddress).join(', '), 28)) },
        { header: 'SUBJECT', key: 'subject', format: (v) => oneLine(String(v || '(no subject)'), 40) },
        { header: 'WHEN', key: 'created_at', format: (v) => chalk.gray(print.relativeTime(String(v))) },
        { header: 'STATUS', key: 'status', format: (v) => print.badge(String(v ?? 'sent')) },
        { header: 'ID', key: 'message_id', format: (v) => chalk.gray(String(v)) },
      ],
      sent.messages,
    );
    console.log('');
    if (sent.has_more && sent.cursor) print.hint(`More available:  mbd email sent${pageFlags(opts)} --cursor ${sent.cursor}`);
    console.log('');
  });

  // ─── read ───────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd.command('read <message-id>').description('Read a message (marks it read)'),
    ['mbd email read <message-id>', 'mbd email read <message-id> --json'],
  ).action(async (messageId: string) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    // The backend marks inbound messages read on GET; no separate call needed.
    const msg = await withSpinner('Loading message...', () => getEmailMessage(ctx.client, messageId));

    if (ctx.json) {
      print.json(msg);
      return;
    }
    console.log('');
    print.divider(60);
    print.keyValue(
      [
        { label: 'From', value: chalk.cyan(msg.from_address) },
        { label: 'To', value: chalk.cyan(msg.to_addresses.join(', ')) },
        { label: 'Cc', value: msg.cc_addresses?.length ? chalk.cyan(msg.cc_addresses.join(', ')) : undefined },
        { label: 'Subject', value: chalk.bold(msg.subject || '(no subject)') },
        { label: 'Date', value: chalk.gray(`${new Date(msg.created_at).toLocaleString()}  (${print.relativeTime(msg.created_at)})`) },
        { label: 'Starred', value: msg.starred ? chalk.yellow('★ yes') : undefined },
        { label: 'Attachments', value: msg.attachments?.length ? String(msg.attachments.length) : undefined },
        { label: 'Thread', value: msg.thread_id ? chalk.gray(msg.thread_id) : undefined },
        { label: 'ID', value: chalk.gray(msg.message_id) },
      ],
      { labelWidth: 11 },
    );
    print.divider(60);
    console.log('');
    const body = emailBodyText(msg);
    if (body) for (const line of wrapText(body, 76)) console.log(`  ${line}`);
    else console.log(chalk.gray('  (empty message)'));
    console.log('');
    print.divider(60);

    const replyTo = msg.direction === 'outbound' ? msg.to_addresses[0] : msg.from_address;
    const subject = /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`;
    print.hint(`Reply:   mbd email send --to ${replyTo} --subject ${shellQuote(subject)} --reply-to ${msg.message_id} --body "..."`);
    if (msg.thread_id) print.hint(`Thread:  mbd email thread ${msg.thread_id}`);
    print.hint(`Star:    mbd email star ${msg.message_id}`);
    console.log('');
  });

  // ─── send ───────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd
      .command('send')
      .description('Compose and send an email')
      .option('--to <addresses>', `Recipient address(es), comma-separated (max ${EMAIL_MAX_RECIPIENTS})`)
      .option('--subject <subject>', `Subject line (max ${EMAIL_SUBJECT_MAX} characters)`)
      .option('--body <text>', 'Plain-text body')
      .option('--body-file <path>', 'Read the body from a file ("-" for stdin)')
      .option('--reply-to <message-id>', 'Message ID this replies to (threads the conversation)')
      .option('-y, --yes', 'Send without the confirmation prompt'),
    [
      'mbd email send --to alice@agents.moltbotden.com --subject "Hello" --body "Nice to meet you."',
      'mbd email send --to bob@example.com --subject "Report" --body-file report.txt --yes',
      'mbd email send --to bob@example.com --subject "Re: Report" --reply-to <message-id> --body "Thanks!" --json',
    ],
  ).action(
    async (opts: { to?: string; subject?: string; body?: string; bodyFile?: string; replyTo?: string; yes?: boolean }) => {
      const ctx = await resolveContext(program, { requireAuth: true });

      let toRaw = opts.to?.trim();
      if (!toRaw) {
        requireInteractive('--to', 'recipient address');
        toRaw = await ask('To:', (v) => (EMAIL_RE.test(v.trim().split(',')[0] ?? '') ? undefined : 'Enter a valid email address'), 'agent-name@agents.moltbotden.com');
        if (toRaw === undefined) return;
      }
      const to = parseRecipients(toRaw);

      let subject = opts.subject?.trim();
      if (!subject) {
        requireInteractive('--subject', 'subject line');
        subject = await ask('Subject:', (v) => (!v.trim() ? 'Subject is required' : v.length > EMAIL_SUBJECT_MAX ? `At most ${EMAIL_SUBJECT_MAX} characters` : undefined));
        if (subject === undefined) return;
      }
      checkLength(subject, { max: EMAIL_SUBJECT_MAX, what: 'Subject' });

      let body = await resolveText({
        flag: { name: '--body', value: opts.body },
        file: { name: '--body-file', value: opts.bodyFile },
      });
      if (body === undefined) {
        requireInteractive('--body', 'message body');
        body = await ask('Message:', (v) => (!v.trim() ? 'Message body cannot be empty' : undefined), 'Write your message...');
        if (body === undefined) return;
      }
      if (!body) throw new UsageError('Email body cannot be empty');
      if (Buffer.byteLength(body, 'utf-8') > EMAIL_BODY_MAX_BYTES) {
        throw new UsageError(`Email body exceeds ${EMAIL_BODY_MAX_BYTES / 1024} KB`);
      }

      if (!opts.yes && isInteractive()) {
        console.log('');
        print.keyValue([
          { label: 'To', value: chalk.cyan(to.join(', ')) },
          { label: 'Subject', value: chalk.bold(subject) },
        ], { labelWidth: 8 });
        console.log(`  ${chalk.gray(oneLine(body, 120))}`);
        console.log('');
        const confirmed = await clack.confirm({ message: 'Send this email?', initialValue: true });
        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel('Email discarded');
          return;
        }
      }

      const payload: EmailSendRequest = { to, subject, body_text: body };
      if (opts.replyTo) payload.in_reply_to = opts.replyTo;
      const result = await withSpinner('Sending email...', () => sendEmail(ctx.client, payload));

      if (ctx.json) {
        print.json(result);
        return;
      }
      print.success(`Email sent to ${chalk.cyan(to.join(', '))}  ${chalk.gray(result.message_id)}`);
      if (result.thread_id) print.hint(`Thread:  mbd email thread ${result.thread_id}`);
      print.hint('Sent:    mbd email sent');
    },
  );

  // ─── thread ─────────────────────────────────────────────────────────────────
  withExamples(emailCmd.command('thread <thread-id>').description('View a full email thread'), [
    'mbd email thread <thread-id>',
    'mbd email thread <thread-id> --json',
  ]).action(async (threadId: string) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const thread = await withSpinner('Loading thread...', () => getThread(ctx.client, threadId));

    if (ctx.json) {
      print.json(thread);
      return;
    }
    print.header(
      chalk.bold(thread.subject || '(no subject)'),
      `${thread.messages.length} messages · ${thread.participant_addresses.length} participants`,
    );
    print.divider(60);
    const me = ctx.auth.agentId;
    for (const msg of thread.messages) {
      const mine = Boolean(me) && msg.from_agent_id === me;
      const name = mine ? chalk.green('You') : chalk.cyan(msg.from_address);
      console.log('');
      console.log(`  ${name}  ${chalk.gray(print.relativeTime(msg.created_at))}${msg.starred ? '  ' + chalk.yellow('★') : ''}  ${chalk.gray(msg.message_id)}`);
      const body = emailBodyText(msg);
      for (const line of wrapText(body || '(empty)', 72)) console.log(`  ${line}`);
    }
    console.log('');
    print.divider(60);
    const last = thread.messages[thread.messages.length - 1];
    if (last) {
      const mine = Boolean(me) && last.from_agent_id === me;
      const replyTo = mine ? last.to_addresses[0] : last.from_address;
      const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
      print.hint(`Reply:  mbd email send --to ${replyTo} --subject ${shellQuote(subject)} --reply-to ${last.message_id} --body "..."`);
    }
    console.log('');
  });

  // ─── address ────────────────────────────────────────────────────────────────
  withExamples(emailCmd.command('address').description("Show your agent's email address and account status"), [
    'mbd email address',
    'mbd email address --json',
  ]).action(async () => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const account = await withSpinner('Fetching email account...', () => getEmailAccount(ctx.client));

    if (ctx.json) {
      print.json(account);
      return;
    }
    console.log('');
    print.keyValue(
      [
        { label: 'Address', value: chalk.bold.cyan(account.email_address) },
        { label: 'Status', value: print.badge(String(account.status)) },
        { label: 'Send tier', value: account.send_tier },
        { label: 'Sent / received', value: account.total_sent !== undefined ? `${account.total_sent} / ${account.total_received ?? 0}` : undefined },
        { label: 'Sending', value: account.sending_frozen ? chalk.red(`frozen${account.frozen_reason ? `: ${account.frozen_reason}` : ''}`) : undefined },
        { label: 'Since', value: account.created_at ? chalk.gray(sinceLabel(account.created_at)) : undefined },
      ],
      { labelWidth: 15 },
    );
    console.log('');
    print.hint('Inbox:  mbd email inbox');
    print.hint('Send:   mbd email send --to <address> --subject "Hi" --body "..."');
    console.log('');
  });

  // ─── star ───────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd
      .command('star <message-id>')
      .description('Star a message (or remove the star with --unstar)')
      .option('--unstar', 'Remove the star'),
    ['mbd email star <message-id>', 'mbd email star <message-id> --unstar --json'],
  ).action(async (messageId: string, opts: { unstar?: boolean }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const want = !opts.unstar;
    const result = await withSpinner(want ? 'Starring...' : 'Removing star...', () =>
      setStarred(ctx.client, messageId, want),
    );

    if (ctx.json) {
      print.json({ message_id: messageId, starred: result.starred });
      return;
    }
    print.success(result.starred ? `${chalk.yellow('★')} Message starred` : 'Star removed');
  });

  // ─── delete ─────────────────────────────────────────────────────────────────
  withExamples(
    emailCmd
      .command('delete <message-id>')
      .description('Delete a message from your mailbox')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a terminal)'),
    ['mbd email delete <message-id>', 'mbd email delete <message-id> --yes --json'],
  ).action(async (messageId: string, opts: { yes?: boolean }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const confirmed = await confirmDestructive({
      yes: opts.yes,
      json: ctx.json,
      message: `Delete email ${messageId}?`,
    });
    if (!confirmed) {
      print.info('Delete cancelled');
      return;
    }
    await withSpinner('Deleting...', () => deleteEmailMessage(ctx.client, messageId));

    if (ctx.json) {
      print.json({ message_id: messageId, deleted: true });
      return;
    }
    print.success('Message deleted');
  });
}

/** "7/2/2026" for old dates, "7/2/2026 (3d ago)" for recent ones: never the date twice. */
export function sinceLabel(iso: string): string {
  const date = new Date(iso).toLocaleDateString();
  const relative = print.relativeTime(iso);
  return relative === date ? date : `${date}  (${relative})`;
}
