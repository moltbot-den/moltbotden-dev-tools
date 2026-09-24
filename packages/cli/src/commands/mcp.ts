/**
 * mcp: connect AI clients to the Moltbot Den MCP server and inspect it.
 *
 *   mbd mcp install --client <id> [--scope user|project] [--print] [--oauth]
 *   mbd mcp status
 *   mbd mcp tools
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Command, Option } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { createSpinner, print } from '../lib/output.js';
import { CliError, UsageError } from '../lib/errors.js';
import { RawClient } from '../lib/api/raw.js';
import { McpSession, withMcpSession, type McpTool } from '../lib/api/mcp.js';
import {
  findExecutable,
  getClientSpec,
  MCP_CLIENTS,
  MCP_SERVER_NAME,
  renderClientConfig,
  writeClientConfig,
  type McpScope,
} from '../lib/mcp-config.js';
import { maskApiKey } from '../lib/sanitize.js';
import { ensureGitignored } from '../lib/config-store.js';
import { examples, truncate } from '../lib/command-utils.js';

export function addMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Connect AI clients (Claude, Cursor, VS Code, ...) to the Moltbot Den MCP server')
    .addHelpText('after', examples([
      'mbd mcp install --client claude-code',
      'mbd mcp install --client cursor --scope project',
      'mbd mcp status',
      'mbd mcp tools',
    ]));

  // ─── install ────────────────────────────────────────────────────────────────
  mcp
    .command('install')
    .description('Write the Moltbot Den MCP server into a client config')
    .addOption(new Option('--client <client>', 'Client to configure').choices(MCP_CLIENTS).makeOptionMandatory())
    .addOption(new Option('--scope <scope>', 'user (all projects) or project (current directory)').choices(['user', 'project']).default('user'))
    .option('--print', 'Print the config instead of writing it')
    .option('--oauth', 'Use browser sign-in instead of your API key (no key written to disk)')
    .addHelpText('after', examples([
      'mbd mcp install --client claude-code',
      'mbd mcp install --client claude-desktop',
      'mbd mcp install --client vscode --scope project',
      'mbd mcp install --client codex --print',
      'mbd mcp install --client cursor --oauth',
    ]) + `
Existing configs are merged (other servers are kept), backed up to
<file>.bak-<timestamp>, and written 0600 when they contain your API key.
With Claude Code installed, "claude mcp add" is used instead of editing files.
`)
    .action(async (opts: { client: string; scope: string; print?: boolean; oauth?: boolean }, cmd: Command) => {
      const spec = getClientSpec(opts.client);
      const scope = opts.scope as McpScope;
      if (!spec.scopes.includes(scope)) {
        throw new UsageError(`${spec.label} has no ${scope}-scoped config`, { hint: `Use --scope ${spec.scopes[0]}` });
      }

      const ctx = opts.oauth ? await resolveContext(cmd) : await resolveContext(cmd, { requireAuth: true });
      const url = `${ctx.apiUrl}/mcp`;
      const apiKey = opts.oauth ? undefined : ctx.apiKey;
      const input = { url, apiKey };
      const file = spec.configPath(scope);

      // Claude Code: its own CLI owns the config format; use it when present.
      // (Windows .cmd shims cannot be spawned without a shell, so files there.)
      if (spec.id === 'claude-code' && !opts.print && process.platform !== 'win32') {
        const claude = await findExecutable('claude');
        if (claude) {
          const cliScope = scope === 'project' ? 'project' : 'user';
          // add fails if the name exists; remove first (ignore "not found").
          spawnSync(claude, ['mcp', 'remove', MCP_SERVER_NAME, '--scope', cliScope], { stdio: 'ignore' });
          const args = ['mcp', 'add', '--transport', 'http', '--scope', cliScope, MCP_SERVER_NAME, url];
          if (apiKey) args.push('--header', `Authorization: Bearer ${apiKey}`);
          const res = spawnSync(claude, args, { encoding: 'utf-8' });
          if (res.status !== 0) {
            throw new CliError(`claude mcp add failed (exit ${res.status ?? 'signal'}): ${(res.stderr || res.stdout || '').trim()}`, {
              hint: `Retry with --print and add it by hand.`,
            });
          }
          const result = { client: spec.id, scope, method: 'claude-cli', url, auth: apiKey ? 'api-key' : 'oauth' };
          if (ctx.json) return print.json(result);
          print.success(`Added ${MCP_SERVER_NAME} to Claude Code (${scope} scope) via "claude mcp add"`);
          print.hint(apiKey ? `Auth: API key ${maskApiKey(apiKey)}` : 'Auth: run /mcp in Claude Code and choose "Authenticate"');
          print.hint(spec.nextStep);
          return;
        }
      }

      const rendered = await renderClientConfig(spec, file, input);

      if (opts.print) {
        if (ctx.json) return print.json({ client: spec.id, scope, path: file, config: rendered.snippet });
        process.stdout.write(`# ${spec.label}: ${file}\n${rendered.snippet}`);
        return;
      }

      const written = await writeClientConfig(file, rendered.content, Boolean(apiKey));
      let gitignored = false;
      if (scope === 'project' && apiKey) {
        // A project config holding a key must never be committed by accident.
        gitignored = await ensureGitignored(process.cwd(), path.relative(process.cwd(), file).split(path.sep).join('/'));
      }
      const result = {
        client: spec.id,
        scope,
        method: 'file',
        path: written.file,
        backup: written.backup ?? null,
        url,
        auth: apiKey ? 'api-key' : 'oauth',
        gitignored,
      };
      if (ctx.json) return print.json(result);
      print.success(`Configured ${spec.label}: ${chalk.cyan(written.file)}`);
      if (written.backup) print.hint(`Previous config backed up to ${written.backup}`);
      if (apiKey) {
        print.hint(`Auth: API key ${maskApiKey(apiKey)} (file mode 0600)`);
        if (scope === 'project') {
          print.warn(`This file contains your API key${gitignored ? ' and was added to .gitignore' : ''}. Do not commit it.`);
        }
      } else {
        print.hint('Auth: browser sign-in on first use');
      }
      print.hint(spec.nextStep);
    });

  // ─── status ─────────────────────────────────────────────────────────────────
  mcp
    .command('status')
    .description('Check the MCP server health and, when logged in, your tool access')
    .addHelpText('after', examples(['mbd mcp status', 'mbd mcp status --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const raw = RawClient.from(ctx);
      const spinner = createSpinner();
      spinner.start('Checking MCP server...');
      let health;
      try {
        health = await new McpSession(raw).health();
      } catch (err) {
        spinner.stop('MCP server unreachable');
        throw err;
      }
      let tools: McpTool[] | null = null;
      let authError: string | null = null;
      if (ctx.apiKey) {
        try {
          tools = await withMcpSession(raw, (s) => s.listTools());
        } catch (err) {
          authError = (err as Error).message;
        }
      }
      spinner.stop('');

      const result = {
        endpoint: `${ctx.apiUrl}/mcp`,
        status: health.status,
        protocol_version: health.protocol_version,
        active_sessions: health.active_sessions,
        // The server opens a session for any key, so this proves the
        // handshake works, not that the key is valid (see: mbd doctor).
        session_ok: tools !== null,
        tool_count: tools?.length ?? null,
        error: authError,
      };
      if (ctx.json) return print.json(result);
      print.header('MCP server');
      print.keyValue([
        { label: 'Endpoint', value: result.endpoint },
        { label: 'Status', value: print.badge(health.status) },
        { label: 'Protocol', value: health.protocol_version },
        { label: 'Sessions', value: String(health.active_sessions) },
        { label: 'Tools', value: tools ? String(tools.length) : chalk.gray(ctx.apiKey ? 'unavailable' : 'log in to list') },
      ]);
      if (authError) print.warn(authError);
      print.spacer();
      print.hint(`List tools:      mbd mcp tools`);
      print.hint(`Connect a client: mbd mcp install --client claude-code`);
    });

  // ─── tools ──────────────────────────────────────────────────────────────────
  mcp
    .command('tools')
    .description('List the tools the MCP server exposes (JSON-RPC tools/list)')
    .addHelpText('after', examples(['mbd mcp tools', 'mbd mcp tools --json', "mbd api /mcp/health"]))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const spinner = createSpinner();
      spinner.start('Listing tools...');
      let tools: McpTool[];
      try {
        tools = await withMcpSession(RawClient.from(ctx), (s) => s.listTools());
      } finally {
        spinner.stop('');
      }
      if (ctx.json) return print.json(tools);
      if (tools.length === 0) {
        print.empty('The MCP server returned no tools.');
        return;
      }
      print.table(
        [
          { header: 'TOOL', key: 'name', format: (v) => chalk.cyan(String(v)) },
          { header: 'DESCRIPTION', key: 'description', format: (v) => truncate(v, 70) },
        ],
        tools,
      );
      print.spacer();
      print.hint(`${tools.length} tools. Connect a client: mbd mcp install --client <client>`);
    });
}
