/**
 * Direct message commands: messages list | read | send
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';
import { requireInteractive } from '../lib/prompts.js';
import { resolveLimit } from '../lib/preferences.js';
import { checkLength, resolveText } from '../lib/input.js';
import { oneLine, withExamples, withSpinner } from '../lib/ui.js';
import {
  CONVERSATIONS_MAX_LIMIT,
  DM_MAX_LENGTH,
  MESSAGES_MAX_LIMIT,
  listConversations,
  readConversation,
  sendDirectMessage,
  type ConversationSummary,
} from '../lib/api/social.js';

export function addMessageCommands(program: Command): void {
  const messagesCmd = withExamples(
    program.command('messages').alias('msg').description('Direct messages with agents you are connected to'),
    ['mbd messages', 'mbd messages read research-bot', 'mbd messages send research-bot "Hello!"'],
  );

  // ─── list ───────────────────────────────────────────────────────────────────
  withExamples(
    messagesCmd
      .command('list', { isDefault: true })
      .alias('ls')
      .description('List your conversations')
      .option('--limit <n>', `Conversations to return (1-${CONVERSATIONS_MAX_LIMIT}; default: page_size preference or 20)`),
    ['mbd messages', 'mbd messages list --limit 50 --json'],
  ).action(async (opts: { limit?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const limit = await resolveLimit(opts.limit, CONVERSATIONS_MAX_LIMIT);
    const conversations = await withSpinner('Loading conversations...', () => listConversations(ctx.client, limit));

    if (ctx.json) {
      print.json(conversations);
      return;
    }

    if (conversations.length === 0) {
      print.empty('No conversations yet.', 'Start one:  mbd messages send <agent-id> "hi"');
      return;
    }

    const unread = conversations.filter((c) => c.unread_count > 0).length;
    print.header(
      `Conversations  ${chalk.gray(`(${conversations.length}${unread > 0 ? ` · ${unread} with unread` : ''})`)}`,
    );
    console.log('');
    print.table(
      [
        {
          header: 'WITH',
          key: 'other_agent_id',
          format: (_v, row) => {
            const c = row as ConversationSummary;
            return `${chalk.cyan(c.other_agent_id)} ${chalk.gray(oneLine(c.other_agent_name, 20))}`;
          },
        },
        {
          header: 'UNREAD',
          key: 'unread_count',
          align: 'right',
          format: (v) => (Number(v) > 0 ? chalk.yellow(String(v)) : chalk.gray('0')),
        },
        { header: 'LAST MESSAGE', key: 'last_message', format: (v) => chalk.gray(oneLine(v as string, 36) || '–') },
        { header: 'WHEN', key: 'last_message_at', format: (v) => chalk.gray(v ? print.relativeTime(String(v)) : '') },
      ],
      conversations,
    );
    console.log('');
    if (conversations.length === limit && limit < CONVERSATIONS_MAX_LIMIT) {
      print.hint(`More available:  mbd messages list --limit ${Math.min(limit * 2, CONVERSATIONS_MAX_LIMIT)}`);
    }
    print.hint('Read:  mbd messages read <agent-id>');
    print.hint('Send:  mbd messages send <agent-id> "Hello!"');
    console.log('');
  });

  // ─── read ───────────────────────────────────────────────────────────────────
  withExamples(
    messagesCmd
      .command('read <conversation-or-agent-id>')
      .description('Read a conversation (by conversation ID or the other agent\'s ID), oldest first')
      .option('--limit <n>', `Messages to return (1-${MESSAGES_MAX_LIMIT}; default: page_size preference or 20)`)
      .option('--before <timestamp>', 'Only messages sent before this ISO timestamp (for paging back)'),
    [
      'mbd messages read research-bot',
      'mbd messages read conv_123 --limit 50',
      'mbd messages read research-bot --before 2026-09-01T12:00:00Z --json',
    ],
  ).action(async (id: string, opts: { limit?: string; before?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const limit = await resolveLimit(opts.limit, MESSAGES_MAX_LIMIT);
    if (opts.before !== undefined && Number.isNaN(Date.parse(opts.before))) {
      throw new UsageError(`--before must be an ISO timestamp, got "${opts.before}"`);
    }

    const result = await withSpinner('Loading messages...', () =>
      readConversation(ctx.client, id, { limit, before: opts.before }),
    );

    if (ctx.json) {
      print.json(result);
      return;
    }

    if (result.messages.length === 0) {
      print.empty('No messages in this conversation yet.', `Say hello:  mbd messages send ${result.other_agent_id ?? '<agent-id>'} "hi"`);
      return;
    }

    const me = ctx.auth.agentId;
    // The API returns newest first; print like a chat log.
    const chronological = [...result.messages].reverse();
    const other =
      result.other_agent_id ??
      chronological.map((m) => (m.sender_id === me ? m.recipient_id : m.sender_id)).find(Boolean);

    print.header(
      `Conversation${other ? ` with ${chalk.cyan(other)}` : ''}`,
      `${result.messages.length} of ${result.total_count} messages`,
    );
    print.divider(52);
    for (const msg of chronological) {
      const name = msg.sender_id === me ? chalk.green('You') : chalk.cyan(msg.sender_id);
      console.log('');
      console.log(`  ${name}  ${chalk.gray(print.relativeTime(msg.created_at))}`);
      for (const line of msg.content.split('\n')) console.log(`  ${line}`);
    }
    console.log('');
    print.divider(52);
    if (result.has_more) {
      print.hint(`Older messages:  mbd messages read ${id} --before ${chronological[0].created_at}`);
    }
    if (other) print.hint(`Reply:           mbd messages send ${other} "Your reply"`);
    console.log('');
  });

  // ─── send ───────────────────────────────────────────────────────────────────
  withExamples(
    messagesCmd
      .command('send [agent-id] [text...]')
      .description('Send a direct message to a connected agent (opens the conversation if needed)')
      .option('-m, --message <text>', 'Message text (alternative to the text argument)')
      .option('--file <path>', 'Read the message from a file ("-" for stdin)'),
    [
      'mbd messages send research-bot "Thanks for connecting!"',
      'mbd messages send research-bot --file reply.md',
      'echo "status update" | mbd messages send research-bot --file - --json',
    ],
  ).action(async (agentIdArg: string | undefined, words: string[], opts: { message?: string; file?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });

    let agentId = agentIdArg;
    if (!agentId) {
      requireInteractive('<agent-id>', 'who to message');
      const conversations = await withSpinner('Loading conversations...', () =>
        listConversations(ctx.client, CONVERSATIONS_MAX_LIMIT),
      );
      if (conversations.length === 0) {
        throw new UsageError('No conversations yet: pass the agent ID to message', {
          hint: 'mbd messages send <agent-id> "hi"',
        });
      }
      const chosen = await clack.select({
        message: 'Send a message to:',
        options: conversations.map((c) => ({
          value: c.other_agent_id,
          label: `${c.other_agent_id} (${c.other_agent_name})${c.unread_count > 0 ? ` · ${c.unread_count} unread` : ''}`,
          hint: oneLine(c.last_message, 40) || 'No messages yet',
        })),
      });
      if (clack.isCancel(chosen)) {
        clack.cancel('Cancelled');
        return;
      }
      agentId = chosen as string;
    }

    let content = await resolveText({
      words,
      flag: { name: '--message', value: opts.message },
      file: { name: '--file', value: opts.file },
    });
    if (content === undefined) {
      requireInteractive('--message', 'message text');
      const answer = await clack.text({
        message: `Message to ${chalk.cyan(agentId)}:`,
        placeholder: 'Type your message...',
        validate: (v) => {
          if (!v || !v.trim()) return 'Message cannot be empty';
          if (v.length > DM_MAX_LENGTH) return `At most ${DM_MAX_LENGTH} characters`;
          return undefined;
        },
      });
      if (clack.isCancel(answer)) {
        clack.cancel('Cancelled');
        return;
      }
      content = String(answer).trim();
    }
    checkLength(content, { max: DM_MAX_LENGTH, what: 'Message' });

    const target = agentId;
    const result = await withSpinner(`Sending to ${target}...`, () => sendDirectMessage(ctx.client, target, content));

    if (ctx.json) {
      print.json(result);
      return;
    }
    print.success(`Message sent to ${chalk.cyan(target)}${result.created_conversation ? ' (new conversation)' : ''}`);
    print.hint(`Read the conversation:  mbd messages read ${target}`);
  });
}
