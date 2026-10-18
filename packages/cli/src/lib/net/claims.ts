/**
 * File claims for Moltbot Den Network (PRD 9.1).
 *
 * A post-tool-use hook that edited files reports them as claims on its
 * session, so two sessions editing the same file in the same repository get a
 * `claim_notice`. A path is sent as sha256(repo_key + ":" + repo-relative
 * path): sessions on the same repo can match it, nobody else can read it. The
 * plaintext path is sent only with --share-paths.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

/** Tools that write files, across runtimes (Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI). */
const EDIT_TOOL = /write|edit|replace|create|patch|notebook|str_replace/i;
const PATH_FIELDS = ['file_path', 'notebook_path', 'path', 'target_file', 'absolute_path', 'filePath', 'filename'];
const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
const MAX_CLAIMS = 20;

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{')) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** Paths a tool call edited, as written in its input (absolute or relative to cwd). */
export function editedPaths(payload: Record<string, unknown>): string[] {
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
  if (!EDIT_TOOL.test(tool)) return [];
  const input = parseMaybeJson(payload.tool_input ?? payload.toolArgs ?? payload.input) as Record<string, unknown> | string | undefined;
  const found: string[] = [];
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.trim() && !found.includes(p.trim())) found.push(p.trim());
  };
  const scanPatch = (text: string) => {
    for (const m of text.matchAll(PATCH_HEADER)) add(m[1] ?? m[2]);
  };
  if (typeof input === 'string') scanPatch(input);
  else if (input && typeof input === 'object') {
    for (const f of PATH_FIELDS) add(input[f]);
    for (const v of Object.values(input)) {
      if (typeof v === 'string' && v.includes('*** ')) scanPatch(v);
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.includes('*** ')) scanPatch(x);
    }
    if (Array.isArray(input.edits)) for (const e of input.edits) add((e as Record<string, unknown>)?.file_path);
  }
  return found.slice(0, MAX_CLAIMS);
}

export interface Claim {
  path_hash: string;
  path_label?: string;
}

export function pathHash(repoKey: string, relPath: string): string {
  return createHash('sha256').update(`${repoKey}:${relPath}`).digest('hex');
}

/** Claims for edited paths inside the repo at `repoRoot`; paths outside it are dropped. */
export function claimsFor(paths: string[], cwd: string, repoRoot: string, repoKey: string, sharePaths = false): Claim[] {
  const out: Claim[] = [];
  for (const p of paths) {
    const abs = path.resolve(cwd, p);
    const rel = path.relative(repoRoot, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const posix = rel.split(path.sep).join('/');
    const claim: Claim = { path_hash: pathHash(repoKey, posix) };
    if (sharePaths) claim.path_label = posix;
    if (!out.some((c) => c.path_hash === claim.path_hash)) out.push(claim);
  }
  return out;
}
