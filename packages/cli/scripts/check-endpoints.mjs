#!/usr/bin/env node
/**
 * Contract check: every endpoint the CLI calls must exist (path + method) in
 * the Moltbot Den OpenAPI spec.
 *
 * Usage:
 *   node scripts/check-endpoints.mjs                 # check against the committed snapshot
 *   node scripts/check-endpoints.mjs --spec <file|url>
 *   node scripts/check-endpoints.mjs --live          # check against https://api.moltbotden.com/openapi.json
 *   node scripts/check-endpoints.mjs --update        # refresh openapi.snapshot.json from the live URL (or --spec)
 *   node scripts/check-endpoints.mjs --json          # machine-readable report
 *
 * Endpoints are extracted statically from src/: `this.get|post|put|patch|delete(path)`
 * in the API client and every `.request('METHOD', path)` call. Template
 * expressions in a path segment become parameters; query strings are ignored.
 *
 * Known, not-yet-fixed mismatches live in tests/contract/known-mismatches.json.
 * The check fails on any mismatch NOT in that list, and on any list entry that
 * now passes (so fixes must delete their entry).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SPEC_URL = 'https://api.moltbotden.com/openapi.json';
export const SNAPSHOT_PATH = path.join(PKG_DIR, 'openapi.snapshot.json');
export const ALLOWLIST_PATH = path.join(PKG_DIR, 'tests', 'contract', 'known-mismatches.json');
const SRC_DIR = path.join(PKG_DIR, 'src');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// ─── Source scanning ──────────────────────────────────────────────────────────

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

/** Skip whitespace; return the new index. */
function skipWs(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Skip a balanced <...> generic argument list starting at src[i] === '<'. */
function skipGeneric(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '<') depth++;
    else if (c === '>' && src[i - 1] !== '=') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Read a string literal at src[i] ('...', "..." or `...` with ${} nesting).
 * Returns { value, end } where template expressions are kept as `${...}`.
 */
function readLiteral(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      value += src[j + 1];
      j += 2;
      continue;
    }
    if (c === quote) return { value, end: j + 1 };
    if (quote === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 0;
      let k = j + 1;
      for (; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      value += '${' + src.slice(j + 2, k) + '}';
      j = k + 1;
      continue;
    }
    value += c;
    j++;
  }
  return null;
}

/** Turn a raw path literal into an OpenAPI-comparable template. */
export function normalizePath(raw) {
  // Drop the query string (a literal '?' outside ${...}) and any trailing
  // ${...} glued to a segment (e.g. `/vms${q}` where q is a query string).
  let out = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '$' && raw[i + 1] === '{') depth++;
    if (depth > 0 && c === '}') depth--;
    if (depth === 0 && c === '?') break;
    out += c;
  }
  const segments = out.split('/').map((seg) => {
    if (/^\$\{[^]*\}$/.test(seg)) return '{param}';
    return seg.replace(/\$\{[^]*\}$/, '');
  });
  let normalized = segments.join('/');
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

/**
 * Extract { method, path, raw, file, line } for every API call in src/.
 */
export function extractEndpoints(srcDir = SRC_DIR) {
  const results = [];
  const shorthand = /this\.(get|post|put|patch|delete)\b/g;
  const generic = /\.request\b/g;

  for (const file of listTsFiles(srcDir)) {
    const src = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(PKG_DIR, file).split(path.sep).join('/');
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;

    const readCallArgs = (idx) => {
      let i = skipWs(src, idx);
      if (src[i] === '<') {
        i = skipGeneric(src, i);
        if (i < 0) return null;
        i = skipWs(src, i);
      }
      if (src[i] !== '(') return null;
      return skipWs(src, i + 1);
    };

    for (const m of src.matchAll(shorthand)) {
      const i = readCallArgs(m.index + m[0].length);
      if (i === null) continue;
      const lit = readLiteral(src, i);
      if (!lit) continue;
      results.push({ method: m[1].toUpperCase(), path: normalizePath(lit.value), raw: lit.value, file: rel, line: lineOf(m.index) });
    }

    for (const m of src.matchAll(generic)) {
      let i = readCallArgs(m.index + m[0].length);
      if (i === null) continue;
      const methodLit = readLiteral(src, i);
      if (!methodLit || !HTTP_METHODS.includes(methodLit.value.toLowerCase())) continue;
      i = skipWs(src, methodLit.end);
      if (src[i] !== ',') continue;
      i = skipWs(src, i + 1);
      const pathLit = readLiteral(src, i);
      if (!pathLit) continue;
      results.push({
        method: methodLit.value.toUpperCase(),
        path: normalizePath(pathLit.value),
        raw: pathLit.value,
        file: rel,
        line: lineOf(m.index),
      });
    }
  }
  return results;
}

// ─── Spec matching ────────────────────────────────────────────────────────────

export async function loadSpec(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Fetching ${source} failed: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(source, 'utf-8'));
}

function segmentsMatch(clientPath, specPath) {
  const a = clientPath.split('/');
  const b = specPath.split('/');
  if (a.length !== b.length) return false;
  // Strict: literal matches literal, parameter matches parameter. A looser
  // match (literal "instances" vs spec "{instance_id}") would hide real bugs:
  // the request would route to the parameterized handler and 404 at runtime.
  const isParam = (seg) => /^\{[^}]+\}$/.test(seg);
  return a.every((seg, i) => (seg === '{param}' ? isParam(b[i]) : seg === b[i]));
}

/**
 * Compare endpoints with the spec. Returns one result per unique METHOD+path:
 * { key, method, path, status: 'ok' | 'missing-path' | 'missing-method', specPath, allowedMethods, sources }
 */
export function checkEndpoints(endpoints, spec) {
  const specPaths = Object.entries(spec.paths ?? {});
  const byKey = new Map();
  for (const ep of endpoints) {
    const key = `${ep.method} ${ep.path}`;
    if (!byKey.has(key)) byKey.set(key, { key, method: ep.method, path: ep.path, sources: [] });
    byKey.get(key).sources.push(`${ep.file}:${ep.line}`);
  }

  const results = [];
  for (const entry of byKey.values()) {
    const candidates = specPaths.filter(([p]) => segmentsMatch(entry.path, p));
    if (candidates.length === 0) {
      results.push({ ...entry, status: 'missing-path', specPath: null, allowedMethods: [] });
      continue;
    }
    const withMethod = candidates.find(([, ops]) => Object.hasOwn(ops, entry.method.toLowerCase()));
    if (withMethod) {
      results.push({ ...entry, status: 'ok', specPath: withMethod[0], allowedMethods: [] });
    } else {
      const allowed = [...new Set(candidates.flatMap(([, ops]) => Object.keys(ops).filter((k) => HTTP_METHODS.includes(k))))];
      results.push({
        ...entry,
        status: 'missing-method',
        specPath: candidates[0][0],
        allowedMethods: allowed.map((m) => m.toUpperCase()),
      });
    }
  }
  return results.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadAllowlist(file = ALLOWLIST_PATH) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return (data.mismatches ?? []).map((m) => (typeof m === 'string' ? m : m.endpoint));
}

/** Split results into unexpected failures and stale allowlist entries. */
export function evaluate(results, allowlist) {
  const allowed = new Set(allowlist);
  const failing = results.filter((r) => r.status !== 'ok');
  const unexpected = failing.filter((r) => !allowed.has(r.key));
  const failingKeys = new Set(failing.map((r) => r.key));
  const stale = allowlist.filter((key) => !failingKeys.has(key));
  return { failing, unexpected, stale };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { spec: undefined, update: false, json: false, live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') args.update = true;
    else if (a === '--json') args.json = true;
    else if (a === '--live') args.live = true;
    else if (a === '--spec') args.spec = argv[++i];
    else if (a.startsWith('--spec=')) args.spec = a.slice('--spec='.length);
    else if (!a.startsWith('-')) args.spec = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.update) {
    const source = args.spec ?? DEFAULT_SPEC_URL;
    const spec = await loadSpec(source);
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(spec, null, 1) + '\n');
    console.log(`Updated ${path.relative(process.cwd(), SNAPSHOT_PATH)} from ${source} (${Object.keys(spec.paths ?? {}).length} paths)`);
    return 0;
  }

  const source = args.spec ?? (args.live ? DEFAULT_SPEC_URL : SNAPSHOT_PATH);
  const spec = await loadSpec(source);
  const results = checkEndpoints(extractEndpoints(), spec);
  const { failing, unexpected, stale } = evaluate(results, loadAllowlist());

  if (args.json) {
    console.log(JSON.stringify({ spec: source, total: results.length, failing, unexpected, stale }, null, 2));
  } else {
    console.log(`Checked ${results.length} endpoints against ${path.isAbsolute(source) ? path.relative(process.cwd(), source) : source}`);
    for (const r of failing) {
      const tag = unexpected.includes(r) ? 'FAIL' : 'known';
      const detail = r.status === 'missing-method' ? `spec has ${r.allowedMethods.join('/')} on ${r.specPath}` : 'path not in spec';
      console.log(`  [${tag}] ${r.key}  (${detail})  ${r.sources[0]}`);
    }
    for (const key of stale) console.log(`  [STALE] ${key} now passes; remove it from tests/contract/known-mismatches.json`);
    if (unexpected.length === 0 && stale.length === 0) {
      console.log(`OK: ${results.length - failing.length} match, ${failing.length} known mismatches`);
    }
  }
  return unexpected.length > 0 || stale.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
