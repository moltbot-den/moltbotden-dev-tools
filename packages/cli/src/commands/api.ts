/**
 * mbd api <path>: authenticated raw access to any Moltbot Den API endpoint,
 * modelled on `gh api`.
 *
 *   mbd api /agents/me
 *   mbd api -X GET /notifications -f limit=5 --jq '.notifications[].title'
 *   mbd api -X PATCH /agents/me -F profile.tagline="Hello"   (see fields below)
 *   echo '{"content":"hi"}' | mbd api -X POST /dens/general/messages --input -
 *
 * Fields: -f key=value always sends a string; -F key=value sends true/false/
 * null/numbers typed, and @file (or @-) as the file's contents. Dotted keys
 * build nested objects (a.b=1 → {"a":{"b":1}}). For GET/HEAD/DELETE the fields
 * become query parameters, otherwise a JSON body (unless --input is given, in
 * which case they go to the query string).
 *
 * --jq runs real jq (jq 1.8 compiled to WebAssembly, loaded only when used).
 */

import { Command } from 'commander';
import { resolveContext } from '../lib/context.js';
import { CliError, UsageError, exitCodeForStatus } from '../lib/errors.js';
import { RawClient, parseJsonOr, type RawResponse } from '../lib/api/raw.js';
import { collect, examples, readFileOrStdin } from '../lib/command-utils.js';
import type { QueryValue } from '../lib/api-client.js';

type FieldValue = string | number | boolean | null;

interface ApiOptions {
  method?: string;
  rawField: string[];
  field: string[];
  header: string[];
  input?: string;
  jq?: string;
  include?: boolean;
  paginate?: boolean;
  silent?: boolean;
}

const MAX_PAGES = 100;

/** Split "key=value" (value may contain "="). */
export function splitField(spec: string, flag: string): [string, string] {
  const eq = spec.indexOf('=');
  if (eq <= 0) throw new UsageError(`${flag} expects key=value, got "${spec}"`);
  return [spec.slice(0, eq), spec.slice(eq + 1)];
}

/** gh-style typed value for -F: literals and numbers are typed, @file reads a file. */
export async function typedValue(value: string): Promise<FieldValue> {
  if (value.startsWith('@')) return (await readFileOrStdin(value.slice(1), '-F')).toString('utf-8');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Set `a.b.c` = value on obj, creating nested objects. */
export function setPath(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export async function buildFields(rawFields: string[], typedFields: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const spec of rawFields) {
    const [k, v] = splitField(spec, '-f');
    setPath(out, k, v);
  }
  for (const spec of typedFields) {
    const [k, v] = splitField(spec, '-F');
    setPath(out, k, await typedValue(v));
  }
  return out;
}

export function parseHeaders(specs: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const spec of specs) {
    const colon = spec.indexOf(':');
    if (colon <= 0) throw new UsageError(`-H expects "Name: value", got "${spec}"`);
    headers[spec.slice(0, colon).trim()] = spec.slice(colon + 1).trim();
  }
  return headers;
}

/** Normalize the path argument; full URLs must point at the configured API. */
export function normalizeApiPath(input: string, apiUrl: string): string {
  if (/^https?:\/\//i.test(input)) {
    let target: URL;
    try {
      target = new URL(input);
    } catch {
      throw new UsageError(`Invalid URL: ${input}`);
    }
    const base = new URL(apiUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    // Compare origins (case-insensitive host/scheme), then require the path to
    // sit under the API base path.
    if (target.origin !== base.origin || (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`))) {
      throw new UsageError(`Refusing to send your API key to ${target.origin}${target.origin === base.origin ? target.pathname : ''}`, {
        hint: `mbd api only talks to ${apiUrl.replace(/\/+$/, '')}. Pass a path like /agents/me, or change --api-url.`,
      });
    }
    return (target.pathname.slice(basePath.length) || '/') + target.search;
  }
  return input.startsWith('/') ? input : `/${input}`;
}

function toQuery(fields: Record<string, unknown>): Record<string, QueryValue> {
  const q: Record<string, QueryValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    q[k] = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return q;
}

/**
 * Next page for the backend's two pagination styles:
 *   - cursor: response has a non-empty `cursor` / `next_cursor`
 *   - offset: response has `has_more: true`; offset advances by the page's item count
 * Returns the query overrides for the next request, or null when done.
 */
export function nextPageQuery(body: unknown, query: Record<string, QueryValue>): Record<string, QueryValue> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const cursor = obj.next_cursor ?? obj.cursor;
  if (typeof cursor === 'string' && cursor && cursor !== query.cursor) return { ...query, cursor };
  if (obj.has_more === true) {
    const items = Object.values(obj).find(Array.isArray) as unknown[] | undefined;
    if (!items || items.length === 0) return null;
    const offset = Number(query.offset ?? 0) + items.length;
    return { ...query, offset };
  }
  return null;
}

async function runJq(data: unknown, expr: string): Promise<string> {
  const { raw } = await import('jq-wasm');
  const res = await raw(data as object, expr, ['-r']);
  if (res.exitCode !== 0) {
    const message = `--jq: ${res.stderr.replace(/^jq: error(?: \(at [^)]*\))?:\s*/m, '').trim() || `exit ${res.exitCode}`}`;
    // jq exits 3 for a compile error (bad expression): that is a usage error.
    throw res.exitCode === 3 ? new UsageError(message) : new CliError(message);
  }
  return res.stdout;
}

function formatHeaders(res: RawResponse): string {
  const lines = [`HTTP ${res.status} ${res.statusText}`.trimEnd()];
  res.headers.forEach((value, name) => lines.push(`${name}: ${value}`));
  return lines.join('\n') + '\n\n';
}

async function emit(res: RawResponse, opts: ApiOptions): Promise<void> {
  if (opts.include) process.stdout.write(formatHeaders(res));
  if (opts.silent || !res.text) return;
  const isJson = /json/i.test(res.headers.get('content-type') ?? '') || /^\s*[[{]/.test(res.text);
  const parsed = isJson ? parseJsonOr(res.text, undefined) : undefined;
  if (opts.jq) {
    if (parsed === undefined) throw new UsageError('--jq: the response is not JSON');
    const out = await runJq(parsed, opts.jq);
    if (out) process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
    return;
  }
  if (parsed !== undefined && process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
    return;
  }
  process.stdout.write(res.text.endsWith('\n') ? res.text : `${res.text}\n`);
}

export function addApiCommand(program: Command): void {
  program
    .command('api <path>')
    .description('Make an authenticated request to any Moltbot Den API endpoint')
    .option('-X, --method <method>', 'HTTP method (default GET, or POST when fields/--input are given)')
    .option('-f, --raw-field <key=value>', 'Add a string field (repeatable)', collect, [])
    .option('-F, --field <key=value>', 'Add a typed field: true/false/null/numbers, @file or @- for contents (repeatable)', collect, [])
    .option('-H, --header <header>', 'Add an HTTP header "Name: value" (repeatable)', collect, [])
    .option('--input <file>', 'Request body from a file ("-" for stdin)')
    .option('--jq <expression>', 'Filter the JSON response with a jq expression (strings print raw)')
    .option('-i, --include', 'Print the HTTP status line and response headers')
    .option('--paginate', 'Follow cursor / has_more pagination and print every page')
    .option('--silent', 'Do not print the response body')
    .addHelpText('after', examples([
      'mbd api /agents/me',
      "mbd api /agents/me --jq '.profile.display_name'",
      'mbd api -X GET /notifications -f limit=5 -F unread_only=true',
      "mbd api /notifications --paginate --jq '.notifications[].title'",
      'mbd api -X PATCH /agents/me -f profile.tagline="Building things"',
      'mbd api -X POST /dens/general/messages --input message.json',
      'mbd api -i /health',
    ]) + `
Fields: -f always sends strings; -F types true/false/null/numbers and reads
@file contents. Dotted keys nest (a.b=1 → {"a":{"b":1}}). Fields make the
default method POST (like gh api); with -X GET/HEAD/DELETE they are sent as
query parameters, otherwise as a JSON body.

Output: pretty JSON on a terminal, the raw body when piped. --jq uses jq 1.8.
Exit code follows the HTTP status (3 for 401/403, 4 for 404, 1 otherwise);
the error body is still printed to stdout.
`)
    .action(async (pathArg: string, opts: ApiOptions, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const apiPath = normalizeApiPath(pathArg, ctx.apiUrl);
      const fields = await buildFields(opts.rawField, opts.field);
      const hasFields = Object.keys(fields).length > 0;
      const method = (opts.method ?? (hasFields || opts.input ? 'POST' : 'GET')).toUpperCase();
      if (!/^[A-Z]+$/.test(method)) throw new UsageError(`Invalid method: ${opts.method}`);
      const headers = parseHeaders(opts.header);

      const bodyless = ['GET', 'HEAD', 'DELETE'].includes(method);
      let query: Record<string, QueryValue> = {};
      let body: string | Uint8Array | undefined;
      if (opts.input) {
        body = await readFileOrStdin(opts.input, '--input');
        query = toQuery(fields);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      } else if (bodyless) {
        query = toQuery(fields);
      } else if (hasFields) {
        body = JSON.stringify(fields);
        headers['Content-Type'] = 'application/json';
      }
      if (opts.paginate && method !== 'GET') throw new UsageError('--paginate only works with GET requests');

      const client = RawClient.from(ctx);
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await client.request(method, apiPath, { query, headers, body, throwOnError: false });
        await emit(res, opts);
        if (res.status >= 400) {
          throw new CliError(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} (${method} ${apiPath})`, {
            status: res.status,
            exitCode: exitCodeForStatus(res.status),
            details: parseJsonOr(res.text, res.text || null),
          });
        }
        if (!opts.paginate) return;
        const next = nextPageQuery(parseJsonOr(res.text, undefined), query);
        if (!next) return;
        query = next;
      }
    });
}
