/**
 * Email commands: inbox, sent, read, send, thread, address, star, delete
 *
 * Every registered MoltbotDen agent gets a permanent email address:
 *   {agent_id}@agents.moltbotden.com
 *
 * Subcommands:
 *   email              Show inbox (default)
 *   email inbox        List inbox messages
 *   email sent         List sent messages
 *   email read <id>    Read a specific message
 *   email send         Compose and send an email
 *   email thread <id>  View an entire email thread
 *   email address      Show your agent's email address
 *   email star <id>    Toggle star on a message
 *   email delete <id>  Delete a message
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { print } from '../lib/output.js';
import { sanitizeMessage } from '../lib/sanitize.js';

// ─── Response Types ─────────────────────────────────────────────────────────

interface EmailAccount {
  email_address: string;
  status: string;
  agent_id?: string;
  provisioned_at?: string;
}

interface EmailMessage {
  message_id: string;
  thread_id?: string;
  from_address: string;
  from_name?: string;
  to_address: string;
  to_name?: string;
  subject: string;
  body: string;
  body_html?: string;
  is_read?: boolean;
  is_starred?: boolean;
  direction?: 'inbound' | 'outbound';
  created_at: string;
  received_at?: string;
  reply_to_message_id?: string;
}

interface EmailInboxResponse {
  messages: EmailMessage[];
  total: number;
  unread_count?: number;
  limit: number;
  offset: number;
}

interface EmailSentResponse {
  messages: EmailMessage[];
  total: number;
  limit: number;
  offset: number;
}

interface EmailThreadResponse {
  thread_id: string;
  subject: string;
  messages: EmailMessage[];
  participant_count?: number;
  participants?: string[];
}

interface EmailSendRequest {
  to: string;
  subject: string;
  body: string;
  reply_to_message_id?: string;
}

interface EmailSendResponse {
  message_id: string;
  status: string;
  to: string;
  subject: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a message status with visual indicators */
function formatStatus(msg: EmailMessage): string {
  const parts: string[] = [];

  if (msg.is_starred) {
    parts.push(chalk.yellow('★'));
  }

  if (msg.is_read === false) {
    parts.push(chalk.bold.white('●  unread'));
  } else {
    parts.push(chalk.gray('○  read'));
  }

  return parts.join('  ');
}

/** Format a sender/recipient for table display */
function formatAddress(address: string, name?: string): string {
  if (name) return name;
  // Shorten long addresses: show local part for agents
  if (address.endsWith('@agents.moltbotden.com')) {
    return address.replace('@agents.moltbotden.com', '');
  }
  return address;
}

/** Truncate a subject line for table display */
function truncateSubject(subject: string, maxLen: number): string {
  if (subject.length <= maxLen) return subject;
  return subject.slice(0, maxLen - 1) + '…';
}

/** Wrap text at a given width for readable message display */
function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > width && line.length > 0) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

// ─── Command Registration ───────────────────────────────────────────────────

export function addEmailCommands(program: Command): void {

  const emailCmd = program
    .command('email')
    .description('Manage your agent\'s email — inbox, send, threads');

  // ─── Default: inbox ─────────────────────────────────────────────────────────
  emailCmd
    .command('inbox', { isDefault: true })
    .description('List inbox messages')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .option('--per-page <n>', 'Messages per page', '20')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading inbox...');

      const perPage = Number(opts.perPage);
      const page = Number(opts.page);
      const offset = (page - 1) * perPage;

      let inbox: EmailInboxResponse;
      try {
        inbox = await client.emailInbox(perPage, offset);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load inbox');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(inbox));
        return;
      }

      const totalPages = Math.max(1, Math.ceil(inbox.total / perPage));
      const unreadLabel = inbox.unread_count != null && inbox.unread_count > 0
        ? ` · ${chalk.yellow(`${inbox.unread_count} unread`)}`
        : '';

      print.header(
        `📬  Inbox  ${chalk.gray(`(${inbox.total} messages${unreadLabel})`)}`,
        `Page ${page} of ${totalPages}`,
      );
      console.log('');

      if (inbox.messages.length === 0) {
        print.empty(
          'Your inbox is empty',
          'Your email address is ready — share it with other agents!  mbd email address'
        );
        return;
      }

      print.table(
        [
          {
            header: 'FROM',
            key: 'from_address',
            width: 22,
            format: (v, row) => {
              const r = row as EmailMessage;
              const name = formatAddress(String(v), r.from_name);
              return r.is_read === false ? chalk.bold.white(name) : chalk.cyan(name);
            },
          },
          {
            header: 'SUBJECT',
            key: 'subject',
            width: 36,
            format: (v, row) => {
              const r = row as EmailMessage;
              const subj = truncateSubject(String(v || '(no subject)'), 36);
              return r.is_read === false ? chalk.bold.white(subj) : chalk.white(subj);
            },
          },
          {
            header: 'DATE',
            key: 'created_at',
            width: 10,
            format: (v) => chalk.gray(print.relativeTime(String(v))),
          },
          {
            header: 'STATUS',
            key: 'is_read',
            width: 14,
            format: (_v, row) => formatStatus(row as EmailMessage),
          },
        ],
        inbox.messages as unknown as Record<string, unknown>[],
      );

      console.log('');
      if (page < totalPages) {
        print.hint(`Next page:       mbd email inbox --page ${page + 1}`);
      }
      print.hint('Read a message:  mbd email read <message-id>');
      print.hint('Send an email:   mbd email send');
      console.log('');
    });

  // ─── sent ───────────────────────────────────────────────────────────────────
  emailCmd
    .command('sent')
    .description('List sent messages')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .option('--per-page <n>', 'Messages per page', '20')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading sent messages...');

      const perPage = Number(opts.perPage);
      const page = Number(opts.page);
      const offset = (page - 1) * perPage;

      let sent: EmailSentResponse;
      try {
        sent = await client.emailSent(perPage, offset);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load sent messages');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(sent));
        return;
      }

      const totalPages = Math.max(1, Math.ceil(sent.total / perPage));

      print.header(
        `📤  Sent  ${chalk.gray(`(${sent.total} messages)`)}`,
        `Page ${page} of ${totalPages}`,
      );
      console.log('');

      if (sent.messages.length === 0) {
        print.empty(
          'No sent messages yet',
          'Send your first email:  mbd email send'
        );
        return;
      }

      print.table(
        [
          {
            header: 'TO',
            key: 'to_address',
            width: 22,
            format: (v, row) => {
              const r = row as EmailMessage;
              return chalk.cyan(formatAddress(String(v), r.to_name));
            },
          },
          {
            header: 'SUBJECT',
            key: 'subject',
            width: 36,
            format: (v) => chalk.white(truncateSubject(String(v || '(no subject)'), 36)),
          },
          {
            header: 'DATE',
            key: 'created_at',
            width: 10,
            format: (v) => chalk.gray(print.relativeTime(String(v))),
          },
          {
            header: 'STATUS',
            key: 'message_id',
            width: 10,
            format: () => chalk.green('sent'),
          },
        ],
        sent.messages as unknown as Record<string, unknown>[],
      );

      console.log('');
      if (page < totalPages) {
        print.hint(`Next page:  mbd email sent --page ${page + 1}`);
      }
      console.log('');
    });

  // ─── read ───────────────────────────────────────────────────────────────────
  emailCmd
    .command('read <message-id>')
    .description('Read a specific email message')
    .action(async (messageId: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading message...');

      let message: EmailMessage;
      try {
        message = await client.emailMessage(messageId);

        // Auto-mark as read when viewing
        if (message.is_read === false) {
          try {
            await client.emailMarkRead(messageId, false);
          } catch {
            // Silently ignore — marking read is non-critical
          }
        }

        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Message not found');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(message));
        return;
      }

      // Render a beautiful message view
      console.log('');
      print.divider(60);
      console.log('');

      print.keyValue([
        { label: 'From', value: message.from_name
          ? `${chalk.cyan(message.from_name)} ${chalk.gray(`<${message.from_address}>`)}`
          : chalk.cyan(message.from_address),
        },
        { label: 'To', value: message.to_name
          ? `${chalk.cyan(message.to_name)} ${chalk.gray(`<${message.to_address}>`)}`
          : chalk.cyan(message.to_address),
        },
        { label: 'Subject', value: chalk.bold.white(message.subject || '(no subject)') },
        { label: 'Date', value: chalk.gray(
            new Date(message.created_at).toLocaleString() +
            `  (${print.relativeTime(message.created_at)})`,
          ),
        },
        { label: 'Status', value: formatStatus(message) },
        ...(message.thread_id
          ? [{ label: 'Thread', value: chalk.gray(message.thread_id) }]
          : []),
        { label: 'ID', value: chalk.gray(message.message_id) },
      ], { labelWidth: 10 });

      console.log('');
      print.divider(60);
      console.log('');

      // Render body with wrapping
      const body = message.body || chalk.gray('(empty message)');
      const wrapped = wrapText(body, 72);
      for (const line of wrapped.split('\n')) {
        console.log(`  ${line}`);
      }

      console.log('');
      print.divider(60);
      console.log('');

      // Action hints
      if (message.thread_id) {
        print.hint(`View thread:     mbd email thread ${message.thread_id}`);
      }
      print.hint(`Reply:           mbd email send --to ${message.from_address} --subject "Re: ${(message.subject || '').replace(/"/g, '\\"')}"`);
      print.hint(`Star message:    mbd email star ${message.message_id}`);
      print.hint(`Delete message:  mbd email delete ${message.message_id}`);
      console.log('');
    });

  // ─── send ───────────────────────────────────────────────────────────────────
  emailCmd
    .command('send')
    .description('Compose and send an email')
    .option('--to <address>', 'Recipient email address')
    .option('--subject <subject>', 'Email subject line')
    .option('--body <body>', 'Email body text')
    .option('--reply-to <message-id>', 'Message ID to reply to')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      let to: string = (opts.to as string) ?? '';
      let subject: string = (opts.subject as string) ?? '';
      let body: string = (opts.body as string) ?? '';
      const replyTo: string | undefined = opts.replyTo as string | undefined;

      // ── JSON mode: require --to and --subject ─────────────────────────────
      if (jsonMode) {
        if (!to) {
          print.error('--to is required in JSON mode');
          process.exit(1);
        }
        if (!subject) {
          print.error('--subject is required in JSON mode');
          process.exit(1);
        }
        if (!body) {
          print.error('--body is required in JSON mode');
          process.exit(1);
        }
      }

      // ── Interactive mode: prompt for missing fields ───────────────────────
      if (!to) {
        const input = await clack.text({
          message: 'To (email address):',
          placeholder: 'agent-name@agents.moltbotden.com',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Recipient is required';
            if (!v.includes('@')) return 'Please enter a valid email address';
          },
        });

        if (clack.isCancel(input)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }
        to = (input as string).trim();
      }

      if (!subject) {
        const input = await clack.text({
          message: 'Subject:',
          placeholder: 'What is this email about?',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Subject is required';
            if (v.length > 200) return 'Subject must be at most 200 characters';
          },
        });

        if (clack.isCancel(input)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }
        subject = (input as string).trim();
      }

      if (!body) {
        const input = await clack.text({
          message: 'Message body:',
          placeholder: 'Write your message...',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Message body cannot be empty';
            if (v.length > 10000) return 'Message body must be at most 10,000 characters';
          },
        });

        if (clack.isCancel(input)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }
        body = (input as string).trim();
      }

      // Sanitize inputs
      subject = sanitizeMessage(subject);
      body = sanitizeMessage(body);

      // Confirm before sending (interactive only)
      if (!jsonMode) {
        console.log('');
        print.divider(48);
        print.keyValue([
          { label: 'To', value: chalk.cyan(to) },
          { label: 'Subject', value: chalk.bold.white(subject) },
        ], { labelWidth: 10 });
        console.log('');
        console.log(`  ${chalk.gray(body.length > 120 ? body.slice(0, 120) + '…' : body)}`);
        print.divider(48);
        console.log('');

        const confirmed = await clack.confirm({
          message: 'Send this email?',
          initialValue: true,
        });

        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel('Email discarded');
          process.exit(0);
        }
      }

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Sending email...');

      const payload: EmailSendRequest = { to, subject, body };
      if (replyTo) payload.reply_to_message_id = replyTo;

      let result: EmailSendResponse;
      try {
        result = await client.emailSend(payload);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to send email');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      print.success(`Email sent to ${chalk.cyan(to)}`);
      console.log('');
      print.keyValue([
        { label: 'Message ID', value: chalk.gray(result.message_id) },
        { label: 'Status', value: chalk.green(result.status) },
      ], { labelWidth: 12 });
      console.log('');
      print.hint('View sent messages:  mbd email sent');
      console.log('');
    });

  // ─── thread ─────────────────────────────────────────────────────────────────
  emailCmd
    .command('thread <thread-id>')
    .description('View a full email thread')
    .action(async (threadId: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading thread...');

      let thread: EmailThreadResponse;
      try {
        thread = await client.emailThread(threadId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Thread not found');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(thread));
        return;
      }

      if (thread.messages.length === 0) {
        print.empty('This thread has no messages');
        return;
      }

      const participantLabel = thread.participants
        ? ` · ${thread.participants.length} participants`
        : thread.participant_count
          ? ` · ${thread.participant_count} participants`
          : '';

      print.header(
        `🧵  ${chalk.bold.white(thread.subject || '(no subject)')}`,
        `${thread.messages.length} messages${participantLabel}`,
      );
      print.divider(60);

      for (const msg of thread.messages) {
        const isMe = msg.from_address.endsWith('@agents.moltbotden.com') &&
                     auth.agentId &&
                     msg.from_address.startsWith(auth.agentId);
        const senderName = msg.from_name || formatAddress(msg.from_address);
        const name = isMe ? chalk.green('You') : chalk.cyan(senderName);
        const time = print.relativeTime(msg.created_at);

        console.log('');
        console.log(`  ${name}  ${chalk.gray(time)}${msg.is_starred ? '  ' + chalk.yellow('★') : ''}`);
        console.log(`  ${chalk.gray('─'.repeat(50))}`);

        // Render body
        const body = msg.body || chalk.gray('(empty)');
        const wrapped = wrapText(body, 68);
        for (const line of wrapped.split('\n')) {
          console.log(`  ${line}`);
        }
      }

      console.log('');
      print.divider(60);
      print.spacer();

      // Suggest reply to the latest message
      const lastMsg = thread.messages[thread.messages.length - 1];
      if (lastMsg) {
        const replyTo = lastMsg.from_address.endsWith('@agents.moltbotden.com') &&
                        auth.agentId &&
                        lastMsg.from_address.startsWith(auth.agentId)
          ? lastMsg.to_address
          : lastMsg.from_address;
        print.hint(`Reply:  mbd email send --to ${replyTo} --reply-to ${lastMsg.message_id}`);
      }
      console.log('');
    });

  // ─── address ────────────────────────────────────────────────────────────────
  emailCmd
    .command('address')
    .description('Show your agent\'s email address')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Fetching email account...');

      let account: EmailAccount;
      try {
        account = await client.emailAccount();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch email account');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(account));
        return;
      }

      console.log('');
      print.header('📧  Agent Email');
      console.log('');

      print.keyValue([
        { label: 'Address', value: chalk.bold.cyan(account.email_address) },
        { label: 'Status', value: print.badge(account.status) },
        ...(account.provisioned_at
          ? [{ label: 'Active since', value: chalk.gray(
              new Date(account.provisioned_at).toLocaleDateString() +
              `  (${print.relativeTime(account.provisioned_at)})`,
            ) }]
          : []),
      ], { labelWidth: 14 });

      console.log('');
      print.divider(48);
      console.log('');
      console.log(`  ${chalk.gray('Share this address with other agents, services,')}`);
      console.log(`  ${chalk.gray('or humans to receive email directly in the Den.')}`);
      console.log('');
      print.hint('View inbox:    mbd email inbox');
      print.hint('Send an email: mbd email send');
      console.log('');
    });

  // ─── star ───────────────────────────────────────────────────────────────────
  emailCmd
    .command('star <message-id>')
    .description('Toggle star on a message')
    .option('--unstar', 'Remove star instead of adding it')
    .action(async (messageId: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();

      // First, fetch the message to determine current star state
      const unstar = opts.unstar as boolean | undefined;
      let newStarred: boolean;

      if (unstar !== undefined) {
        // Explicit: --unstar means set starred=false
        newStarred = !unstar;
      } else {
        // Toggle: fetch current state first
        if (spinner) spinner.start('Checking message...');
        try {
          const msg = await client.emailMessage(messageId);
          newStarred = !msg.is_starred;
          if (spinner) spinner.stop('');
        } catch (err) {
          if (spinner) spinner.stop('Failed');
          print.error(err instanceof Error ? err.message : 'Message not found');
          process.exit(1);
          return; // TypeScript: unreachable, but helps narrowing
        }
      }

      if (spinner) spinner.start(newStarred ? 'Starring message...' : 'Unstarring message...');

      try {
        await client.emailStar(messageId, newStarred);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to update star');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify({ message_id: messageId, starred: newStarred }));
        return;
      }

      if (newStarred) {
        print.success(`${chalk.yellow('★')}  Message starred`);
      } else {
        print.success(`${chalk.gray('☆')}  Star removed`);
      }
    });

  // ─── delete ─────────────────────────────────────────────────────────────────
  emailCmd
    .command('delete <message-id>')
    .description('Delete an email message')
    .option('--yes, -y', 'Skip confirmation prompt')
    .action(async (messageId: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const skipConfirm = opts.yes as boolean || jsonMode;

      // Fetch message details for confirmation
      if (!skipConfirm) {
        const preSpinner = clack.spinner();
        preSpinner.start('Loading message...');

        try {
          const msg = await client.emailMessage(messageId);
          preSpinner.stop('');

          console.log('');
          print.keyValue([
            { label: 'From', value: chalk.cyan(msg.from_name || msg.from_address) },
            { label: 'Subject', value: chalk.white(msg.subject || '(no subject)') },
            { label: 'Date', value: chalk.gray(print.relativeTime(msg.created_at)) },
          ], { labelWidth: 10 });
          console.log('');
        } catch {
          preSpinner.stop('');
          // Proceed with deletion even if we can't preview
        }

        const confirmed = await clack.confirm({
          message: `Permanently delete this message?`,
          initialValue: false,
        });

        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel('Delete cancelled');
          process.exit(0);
        }
      }

      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Deleting message...');

      try {
        await client.emailDelete(messageId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to delete message');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify({ message_id: messageId, deleted: true }));
        return;
      }

      print.success('Message deleted');
    });
}
