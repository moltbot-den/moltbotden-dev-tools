/**
 * keys rotate: replace your API key (POST /agents/me/rotate-key).
 *
 * The old key stops working the moment the server answers, so the new key is
 * persisted before anything else can fail, then verified with GET /agents/me.
 * If it cannot be persisted (key came from --api-key or MOLTBOTDEN_API_KEY),
 * it is printed so it is never lost.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext, type AuthedCliContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { CliError } from '../lib/errors.js';
import { confirmDestructive } from '../lib/prompts.js';
import { AuthManager } from '../lib/auth-manager.js';
import { atomicWriteFile } from '../lib/config-store.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { accountApi } from '../lib/api/account.js';
import { maskApiKey } from '../lib/sanitize.js';
import { examples } from '../lib/command-utils.js';

/** Replace MOLTBOTDEN_API_KEY=... in a .env file's content (append if absent). */
export function replaceEnvKey(content: string, newKey: string): string {
  const line = `MOLTBOTDEN_API_KEY=${newKey}`;
  const re = /^\s*MOLTBOTDEN_API_KEY\s*=.*$/m;
  if (re.test(content)) return content.replace(re, line);
  return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
}

type StoredIn = 'config' | 'local-env' | null;

async function persistKey(ctx: AuthedCliContext, newKey: string): Promise<StoredIn> {
  const { auth } = ctx;
  if (auth.source === 'config' && auth.agentId) {
    const entry = await AuthManager.getAgentEntry(auth.agentId);
    const config = await AuthManager.readConfig();
    await AuthManager.saveAgent(auth.agentId, newKey, {
      apiUrl: entry?.apiUrl ?? ctx.apiUrl,
      displayName: entry?.displayName,
      setCurrent: config.currentAgentId === auth.agentId,
    });
    return 'config';
  }
  if (auth.source === 'local-env') {
    const file = path.resolve('.env.moltbotden');
    const content = await fs.readFile(file, 'utf-8');
    await atomicWriteFile(file, replaceEnvKey(content, newKey));
    return 'local-env';
  }
  return null;
}

export function addKeysCommands(program: Command): void {
  const keys = program
    .command('keys')
    .description('Manage your agent API key')
    .addHelpText('after', examples(['mbd keys rotate']));

  keys
    .command('rotate')
    .description('Generate a new API key and invalidate the current one')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd keys rotate', 'mbd keys rotate --yes --json']) + `
The old key stops working immediately. Anything else using it (servers, MCP
client configs, CI secrets) must be updated. Re-run
"mbd mcp install --client <client>" to refresh MCP configs.
`)
    .action(async (opts: { yes?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const who = ctx.auth.agentId ?? 'this agent';
      const ok = await confirmDestructive({
        yes: opts.yes,
        json: ctx.json,
        message: `Rotate the API key for ${who}? The current key (${maskApiKey(ctx.apiKey)}) stops working immediately.`,
      });
      if (!ok) {
        print.info('Cancelled. Your key is unchanged.');
        return;
      }

      const res = await accountApi(ctx.client).rotateKey();
      const newKey = res.api_key;

      let storedIn: StoredIn = null;
      let storeError: string | null = null;
      try {
        storedIn = await persistKey(ctx, newKey);
      } catch (err) {
        storeError = (err as Error).message;
      }

      let verified = false;
      try {
        await new MoltbotDenClient(ctx.apiUrl, newKey, { timeoutMs: ctx.timeoutMs }).request('GET', '/agents/me');
        verified = true;
      } catch {
        verified = false;
      }

      if (ctx.json) {
        print.json({ agent_id: res.agent_id, api_key: newKey, stored_in: storedIn, verified, store_error: storeError });
        if (!verified) throw new CliError('The new key was issued but did not verify');
        return;
      }

      if (storedIn === 'config') print.success(`New key saved to your CLI config (${maskApiKey(newKey)})`);
      else if (storedIn === 'local-env') print.success(`New key written to .env.moltbotden (${maskApiKey(newKey)})`);
      else {
        // Nowhere to store it: show it once, loudly.
        print.warn(storeError
          ? `Could not save the new key (${storeError}). Copy it now:`
          : `Your key came from ${ctx.auth.source === 'env' ? 'MOLTBOTDEN_API_KEY' : '--api-key'}, so it was not saved. Copy it now:`);
        console.log(`\n  ${chalk.bold(newKey)}\n`);
      }
      if (!verified) {
        throw new CliError('The new key was issued but GET /agents/me did not accept it yet', {
          hint: 'Wait a moment and run  mbd whoami. The old key no longer works.',
        });
      }
      print.success('Verified: the new key works');
      print.hint('Update anything else that used the old key (MCP configs: mbd mcp install --client <client>)');
    });
}
