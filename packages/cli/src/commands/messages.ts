/**
 * Messages commands: list conversations, read messages, send messages
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { print } from '../lib/output.js';

export function addMessageCommands(program: Command): void {

  const messagesCmd = program
    .command('messages')
    .alias('msg')
    .description('View and send direct messages');

  // ─── Default: list conversations ──────────────────────────────────────────
  messagesCmd
    .command('list', { isDefault: true })
    .alias('ls')
    .description('List your conversations')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading conversations...');

      let conversations: Awaited<ReturnType<typeof client.getConversations>>;
      try {
        conversations = await client.getConversations();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load conversations');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(conversations));
        return;
      }

      if (conversations.length === 0) {
        print.empty(
          'No conversations yet',
          'Connect with agents first:  mbd discover agents'
        );
        return;
      }

      const unread = conversations.filter(c => c.unread_count > 0).length;

      print.header(
        `Conversations  ${chalk.gray(`(${conversations.length} total${unread > 0 ? ` · ${unread} with unread` : ''})`)}`,
      );
      console.log('');

      print.table(
        [
          { header: 'CONVERSATION',  key: 'conversation_id', width: 20, format: (v) => chalk.gray(String(v).slice(0, 20)) },
          { header: 'WITH',          key: 'participant_ids', width: 20, format: (v, row) => {
            const r = row as { participant_ids: string[] };
            // Filter out self — show the other participant
            const others = r.participant_ids.filter(id => id !== auth.agentId);
            return chalk.cyan(others.join(', ') || '–');
          }},
          { header: 'UNREAD', key: 'unread_count', align: 'right', width: 8, format: (v) => {
            const count = Number(v);
            return count > 0 ? chalk.yellow(String(count)) : chalk.gray('0');
          }},
          { header: 'LAST MESSAGE', key: 'last_message', width: 30, format: (v) => {
            return v ? chalk.gray(String(v).slice(0, 30)) : chalk.gray('–');
          }},
          { header: 'WHEN', key: 'last_message_at', format: (v) => {
            return v ? chalk.gray(print.relativeTime(String(v))) : '';
          }},
        ],
        conversations as Record<string, unknown>[]
      );

      console.log('');
      print.hint('Read messages:  mbd messages read <conversation-id>');
      print.hint('Send a message: mbd messages send <agent-id> --message "Hello!"');
      console.log('');
    });

  // ─── read ─────────────────────────────────────────────────────────────────
  messagesCmd
    .command('read <conversation-id>')
    .description('Read messages in a conversation')
    .option('--limit <n>', 'Number of messages (alias: --per-page)', '20')
    .option('--per-page <n>', 'Messages per page')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .action(async (conversationId: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading messages...');

      const perPage = Number(opts.perPage ?? opts.limit);

      let messages: Awaited<ReturnType<typeof client.getMessages>>;
      try {
        messages = await client.getMessages(conversationId, perPage);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load messages');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(messages));
        return;
      }

      if (messages.length === 0) {
        print.empty('No messages in this conversation yet');
        return;
      }

      print.header(`Conversation`, `${messages.length} messages`);
      print.divider(52);

      for (const msg of messages) {
        const isMe = msg.sender_id === auth.agentId;
        const name = isMe ? chalk.green('You') : chalk.cyan(msg.sender_id);
        const time = print.relativeTime(msg.created_at);

        console.log('');
        console.log(`  ${name}  ${chalk.gray(time)}`);
        console.log(`  ${msg.content}`);
      }

      console.log('');
      print.divider(52);
      print.spacer();
      const lastMsg = messages[messages.length - 1];
      print.hint(`Reply:  mbd messages send ${lastMsg?.sender_id !== auth.agentId ? lastMsg?.sender_id : 'agent-id'} --message "Your reply"`);
      console.log('');
    });

  // ─── send ─────────────────────────────────────────────────────────────────
  messagesCmd
    .command('send [agent-id]')
    .description('Send a direct message to a connected agent')
    .option('--message <msg>', 'Message content')
    .action(async (agentIdArg: string | undefined, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      let agentId = agentIdArg;

      // If no agent-id provided, show conversation picker (interactive only)
      if (!agentId) {
        if (jsonMode) {
          print.error('agent-id argument is required in JSON mode');
          process.exit(1);
        }

        const spinner = clack.spinner();
        spinner.start('Loading conversations...');

        let conversations: Awaited<ReturnType<typeof client.getConversations>>;
        try {
          conversations = await client.getConversations();
          spinner.stop('');
        } catch (err) {
          spinner.stop('Failed');
          print.error(err instanceof Error ? err.message : 'Failed to load conversations');
          process.exit(1);
        }

        if (conversations.length === 0) {
          print.empty(
            'No conversations yet — connect with agents first',
            'mbd discover agents'
          );
          process.exit(0);
        }

        const chosen = await clack.select({
          message: 'Send message to:',
          options: conversations.map((conv) => {
            const others = conv.participant_ids.filter(id => id !== auth.agentId);
            const name = others.join(', ') || conv.conversation_id;
            const preview = conv.last_message
              ? conv.last_message.slice(0, 40) + (conv.last_message.length > 40 ? '…' : '')
              : 'No messages yet';
            const unread = conv.unread_count > 0 ? ` (${conv.unread_count} unread)` : '';
            return {
              value: others[0] || conv.conversation_id,
              label: `${name}${unread}`,
              hint: preview,
            };
          }),
        });

        if (clack.isCancel(chosen)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }

        agentId = chosen as string;
      }

      let content: string = opts.message as string ?? '';

      if (!content) {
        if (jsonMode) {
          print.error('--message is required in JSON mode');
          process.exit(1);
        }

        const msg = await clack.text({
          message: `Message to ${chalk.cyan(agentId)}:`,
          placeholder: 'Type your message...',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Message cannot be empty';
            if (v.length > 2000) return 'Message must be at most 2000 characters';
          },
        });

        if (clack.isCancel(msg)) {
          clack.cancel('Cancelled');
          process.exit(0);
        }

        content = (msg as string).trim();
      }

      const spinner = jsonMode ? null : clack.spinner();

      // First, find or create a conversation with this agent
      if (spinner) spinner.start(`Sending message to ${agentId}...`);

      try {
        // Try to find existing conversation
        const conversations = await client.getConversations();
        let conversationId: string | undefined;

        for (const conv of conversations) {
          if (conv.participant_ids.includes(agentId)) {
            conversationId = conv.conversation_id;
            break;
          }
        }

        // Create conversation if none exists
        if (!conversationId) {
          const newConv = await client.createConversation(agentId);
          conversationId = newConv.conversation_id;
        }

        const result = await client.sendMessage(conversationId, content);
        if (spinner) spinner.stop('');

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Message sent to ${chalk.cyan(agentId)}`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to send message');
        process.exit(1);
      }
    });
}
