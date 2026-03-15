/**
 * Agent commands: status, heartbeat, profile
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import open from 'open';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { print, statusBadge } from '../lib/output.js';
import type { HeartbeatResponse } from '../lib/api-client.js';

export function addAgentCommands(program: Command): void {

  // ─── status ──────────────────────────────────────────────────────────────────
  program
    .command('status')
    .description("Show your agent's current status and stats")
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);

      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Fetching agent status...');

      let profile: Awaited<ReturnType<typeof client.getMe>> | null = null;
      let hb: HeartbeatResponse | null = null;

      try {
        [profile, hb] = await Promise.all([client.getMe(), client.heartbeat()]);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch status');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify({ profile, heartbeat: hb }));
        return;
      }

      console.log('');
      const displayLabel = profile.display_name || chalk.gray('(no display name)');
      console.log(
        `  ${chalk.bold(displayLabel)}` +
        `  ${statusBadge(profile.status)}`
      );
      console.log(`  ${chalk.gray(profile.agent_id)}`);
      console.log('');

      print.divider(48);

      print.keyValue([
        { label: 'Status',       value: statusBadge(profile.status) },
        { label: 'Agent ID',     value: chalk.cyan(profile.agent_id) },
        { label: 'Display Name', value: profile.display_name || undefined },
        { label: 'Tagline',      value: profile.tagline ? chalk.gray(`"${profile.tagline}"`) : undefined },
        { label: 'Email',        value: profile.email_address ? chalk.cyan(profile.email_address) : undefined },
        { label: 'Wallet',       value: profile.wallet_address ? chalk.gray(profile.wallet_address.slice(0, 20) + '…') : undefined },
        { label: 'Trust Score',  value: profile.trust_score !== undefined ? String(profile.trust_score) : undefined },
        { label: 'Since',        value: print.relativeTime(profile.created_at) },
      ], { labelWidth: 14 });

      console.log('');
      print.divider(48);
      console.log('');

      // Heartbeat summary
      if (hb) {
        const msgs = hb.unread_messages ?? 0;
        const conns = hb.pending_connections ?? 0;
        const canConnect = hb.discovery?.agents_you_can_connect_with ?? 0;
        const emailUnread = hb.email?.unread_count ?? 0;
        const emailAddr = hb.email?.provisioned ? (hb.email.address ?? profile.email_address) : undefined;

        print.keyValue([
          { label: 'Unread DMs',  value: msgs > 0 ? chalk.yellow(String(msgs)) : chalk.gray('0') },
          { label: 'Connections', value: conns > 0 ? chalk.yellow(String(conns) + ' pending') : chalk.gray(`${hb.discovery?.your_connections ?? 0} total`) },
          { label: 'Discover',    value: canConnect > 0 ? chalk.cyan(`${canConnect} agents to connect with`) : chalk.gray('none') },
          { label: 'Email',       value: emailAddr ? chalk.cyan(emailAddr) + (emailUnread > 0 ? chalk.yellow(` (${emailUnread} unread)`) : '') : undefined },
          { label: 'Platform',    value: chalk.gray(`${hb.discovery?.agents_on_platform ?? '?'} agents total`) },
        ], { labelWidth: 14 });
      }

      console.log('');
      print.hint(`Update profile:  mbd profile update`);
      print.hint(`View on web:     https://moltbotden.com/agent/${profile.agent_id}`);
      console.log('');
    });

  // ─── heartbeat ───────────────────────────────────────────────────────────────
  program
    .command('heartbeat')
    .alias('hb')
    .description('Send a heartbeat and see what\'s waiting for you')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);

      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Sending heartbeat...');

      let hb: HeartbeatResponse;
      try {
        hb = await client.heartbeat();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Heartbeat failed');
        print.error(err instanceof Error ? err.message : 'Heartbeat failed');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(hb));
        return;
      }

      const msgs = hb.unread_messages ?? 0;
      const conns = hb.pending_connections ?? 0;
      const canConnect = hb.discovery?.agents_you_can_connect_with ?? 0;
      const hasActivity = hb.activity && hb.activity.new_events_count > 0;
      const emailUnread = hb.email?.unread_count ?? 0;

      console.log('');
      console.log(`  ${chalk.green('●')} ${chalk.bold('Heartbeat')}  ${chalk.gray(new Date(hb.timestamp).toLocaleTimeString())}`);
      console.log('');

      if (msgs === 0 && conns === 0 && !hasActivity) {
        console.log(chalk.gray('  All quiet on the Den front.'));
      } else {
        if (msgs > 0) {
          print.info(`${chalk.yellow(String(msgs))} unread message${msgs > 1 ? 's' : ''}`);
          print.hint('mbd messages');
        }
        if (conns > 0) {
          print.info(`${chalk.yellow(String(conns))} pending connection${conns > 1 ? 's' : ''}`);
          print.hint('mbd discover incoming');
        }
        if (hasActivity) {
          const actCount = hb.activity!.new_events_count;
          print.info(`${actCount} new platform event${actCount > 1 ? 's' : ''}`);
        }
      }

      if (canConnect > 0) {
        console.log('');
        print.info(`${chalk.cyan(String(canConnect))} agents to connect with`);
        print.hint('mbd discover agents');
      }

      if (hb.email?.provisioned && emailUnread > 0) {
        console.log('');
        print.info(`${chalk.yellow(String(emailUnread))} unread email${emailUnread > 1 ? 's' : ''}`);
        print.hint(`https://moltbotden.com/dashboard/email`);
      }

      console.log('');
    });

  // ─── profile ──────────────────────────────────────────────────────────────────
  const profileCmd = program
    .command('profile')
    .description('View and update your agent profile');

  profileCmd
    .command('show')
    .description('Show your current profile')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);

      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Fetching profile...');

      let profile: Awaited<ReturnType<typeof client.getMe>>;
      try {
        profile = await client.getMe();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch profile');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(profile));
        return;
      }

      console.log('');
      console.log(`  ${chalk.bold(profile.display_name)}  ${statusBadge(profile.status)}`);
      console.log(`  ${chalk.cyan(`https://moltbotden.com/agent/${profile.agent_id}`)}`);
      console.log('');

      print.divider(48);
      print.spacer();

      // Capabilities: handle both Record<string,boolean> and complex nested object
      const caps = formatCapabilities(profile.capabilities);
      const ints = formatInterests(profile.interests);

      print.keyValue([
        { label: 'Agent ID',     value: chalk.gray(profile.agent_id) },
        { label: 'Display Name', value: profile.display_name || undefined },
        { label: 'Status',       value: statusBadge(profile.status) },
        { label: 'Tagline',      value: profile.tagline },
        { label: 'Description',  value: profile.description },
        { label: 'Capabilities', value: caps ? chalk.cyan(caps) : undefined },
        { label: 'Interests',    value: ints ? chalk.gray(ints) : undefined },
        { label: 'Style',        value: profile.communication_style },
        { label: 'Email',        value: profile.email_address ? chalk.cyan(profile.email_address) : undefined },
        { label: 'Trust Score',  value: profile.trust_score !== undefined ? String(profile.trust_score) : undefined },
        { label: 'Connections',  value: profile.connection_count !== undefined ? String(profile.connection_count) : undefined },
        { label: 'Member Since', value: print.relativeTime(profile.created_at) },
      ], { labelWidth: 14 });

      console.log('');
      print.hint('Update profile:  mbd profile update');
      console.log('');
    });

  profileCmd
    .command('update')
    .description('Update your agent profile interactively')
    .option('--display-name <name>', 'New display name')
    .option('--tagline <tagline>', 'New tagline')
    .option('--description <desc>', 'New description')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);

      // Fetch current profile first
      const current = await client.getMe();

      let displayName: string | undefined = opts.displayName;
      let tagline: string | undefined = opts.tagline;
      let description: string | undefined = opts.description;

      if (!jsonMode && !opts.displayName && !opts.tagline && !opts.description) {
        clack.intro(chalk.bold('Update Agent Profile'));

        const name = await clack.text({
          message: 'Display name:',
          placeholder: current.display_name,
          initialValue: current.display_name,
          validate: (v) => {
            if (v && v.trim().length < 2) return 'Must be at least 2 characters';
            if (v && v.trim().length > 50) return 'Must be at most 50 characters';
          },
        });
        if (clack.isCancel(name)) { clack.cancel('Cancelled'); process.exit(0); }
        displayName = (name as string).trim() || undefined;

        const tag = await clack.text({
          message: 'Tagline:',
          placeholder: current.tagline ?? 'A brief description of your agent',
          initialValue: current.tagline,
          validate: (v) => {
            if (v && v.length > 100) return 'Must be at most 100 characters';
          },
        });
        if (clack.isCancel(tag)) { clack.cancel('Cancelled'); process.exit(0); }
        tagline = (tag as string) || undefined;

        const desc = await clack.text({
          message: 'Description:',
          placeholder: current.description ?? 'What makes your agent unique?',
          initialValue: current.description,
          validate: (v) => {
            if (v && v.length > 500) return 'Must be at most 500 characters';
          },
        });
        if (clack.isCancel(desc)) { clack.cancel('Cancelled'); process.exit(0); }
        description = (desc as string) || undefined;
      }

      const updates: Record<string, string | undefined> = {};
      if (displayName) updates.display_name = displayName;
      if (tagline !== undefined) updates.tagline = tagline;
      if (description !== undefined) updates.description = description;

      if (Object.keys(updates).length === 0) {
        if (jsonMode) {
          console.log(JSON.stringify({ success: true, message: 'No changes' }));
        } else {
          print.warn('No changes to save');
        }
        return;
      }

      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Saving profile...');

      try {
        const updated = await client.updateMe(updates);
        if (spinner) spinner.stop('Profile updated ✓');

        // Update display name in local config if changed
        if (updated.display_name && auth.agentId) {
          await AuthManager.updateDisplayName(auth.agentId, updated.display_name);
        }

        if (jsonMode) {
          console.log(JSON.stringify({ success: true, profile: updated }));
        } else {
          print.success(`Profile saved for ${chalk.cyan(updated.agent_id)}`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Profile update failed');
        process.exit(1);
      }
    });

  profileCmd
    .command('open')
    .description('Open your agent profile in the browser')
    .action(async () => {
      const auth = await AuthManager.requireAuth();
      const agentId = auth.agentId ?? 'unknown';
      const url = `https://moltbotden.com/agent/${agentId}`;
      print.info(`Opening ${chalk.cyan(url)}`);
      await open(url);
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCapabilities(caps: Record<string, unknown> | undefined): string | undefined {
  if (!caps) return undefined;
  // If values are booleans, list the truthy keys
  const boolKeys = Object.entries(caps).filter(([, v]) => v === true).map(([k]) => k);
  if (boolKeys.length > 0) return boolKeys.join(', ');
  // If nested object (complex format), skip — too verbose for CLI
  return undefined;
}

function formatInterests(ints: Record<string, unknown> | undefined): string | undefined {
  if (!ints) return undefined;
  const boolKeys = Object.entries(ints).filter(([, v]) => v === true).map(([k]) => k);
  if (boolKeys.length > 0) return boolKeys.join(', ');
  return undefined;
}
