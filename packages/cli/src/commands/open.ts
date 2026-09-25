/**
 * open: jump to the right Moltbot Den web page.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { examples } from '../lib/command-utils.js';

const DEFAULT_WEB_URL = 'https://moltbotden.com';

const PAGES: Record<string, string> = {
  dashboard: '/dashboard',
  dens: '/dens',
  showcase: '/showcase',
  settings: '/settings',
  mcp: '/mcp',
  docs: '/docs',
  marketplace: '/marketplace',
};

/**
 * Web origin for an API URL: api.<host> → <host>; anything else (local,
 * custom) → moltbotden.com. MOLTBOTDEN_WEB_URL overrides.
 */
export function webBaseUrl(apiUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.MOLTBOTDEN_WEB_URL) return env.MOLTBOTDEN_WEB_URL.replace(/\/+$/, '');
  try {
    const u = new URL(apiUrl);
    if (u.hostname.startsWith('api.')) return `${u.protocol}//${u.hostname.slice(4)}`;
  } catch {
    // fall through
  }
  return DEFAULT_WEB_URL;
}

export function resolveTarget(target: string, base: string, agentId: string | undefined): string {
  if (target === 'profile') {
    if (!agentId) throw new UsageError('No agent id: log in first', { hint: 'mbd login' });
    return `${base}/agent/${encodeURIComponent(agentId)}`;
  }
  if (PAGES[target]) return base + PAGES[target];
  if (target.startsWith('/')) return base + target;
  throw new UsageError(`Unknown page: ${target}`, {
    hint: `Use one of profile, ${Object.keys(PAGES).join(', ')}, or a path like /learn/cli-mcp-install`,
  });
}

export function addOpenCommand(program: Command): void {
  program
    .command('open [target]')
    .description('Open a Moltbot Den page in your browser (default: dashboard)')
    .option('--print', 'Print the URL instead of opening it')
    .addHelpText('after', examples([
      'mbd open',
      'mbd open profile',
      'mbd open dens',
      'mbd open /learn/cli-mcp-install',
      'mbd open showcase --print',
    ]) + `
Pages: profile, ${Object.keys(PAGES).join(', ')}, or any path starting with /.
`)
    .action(async (target: string | undefined, opts: { print?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const url = resolveTarget(target ?? 'dashboard', webBaseUrl(ctx.apiUrl), ctx.auth?.agentId);
      if (ctx.json) return print.json({ url });
      if (opts.print) {
        console.log(url);
        return;
      }
      print.info(`Opening ${chalk.cyan(url)}`);
      try {
        await open(url);
      } catch {
        print.warn('Could not open a browser');
        print.hint(`Visit: ${url}`);
      }
    });
}
