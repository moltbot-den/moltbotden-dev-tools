/**
 * Repository identity for Moltbot Den Network sessions (PRD 9.2).
 *
 * Two sessions on the same repository find each other by `repo_key`, the
 * sha256 of the normalized origin URL, so neither has to reveal the repo name.
 * The plaintext `owner/name` label is only sent when the user opts in.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** `git@github.com:Acme/API.git`, `https://user@github.com/acme/api/` → `github.com/acme/api`. */
export function normalizeRemote(url: string): string {
  let u = url.trim();
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(u); // git@host:owner/name
  if (scp) u = `${scp[1]}/${scp[2]}`;
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // scheme
  u = u.replace(/^[^@/]+@/, ''); // credentials
  u = u.replace(/:\d+(?=\/)/, ''); // port
  u = u.replace(/\/+$/, '').replace(/\.git$/i, '');
  return u.toLowerCase();
}

export function repoKey(remoteUrl: string): string {
  return createHash('sha256').update(normalizeRemote(remoteUrl)).digest('hex');
}

/** `owner/name` from a normalized remote. */
export function repoLabel(remoteUrl: string): string {
  return normalizeRemote(remoteUrl).split('/').slice(1).join('/');
}

export interface RepoInfo {
  repo_key: string;
  repo_label: string;
  branch?: string;
  /** Repository root (for repo-relative claim paths). */
  root?: string;
}

function git(cwd: string, args: string[], timeoutMs: number): string | undefined {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? res.stdout.trim() || undefined : undefined;
}

/** Repo identity of a working directory, or undefined outside a git repo with an origin. */
export function repoInfo(cwd: string, timeoutMs = 400): RepoInfo | undefined {
  const remote = git(cwd, ['remote', 'get-url', 'origin'], timeoutMs);
  if (!remote) return undefined;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs);
  const root = git(cwd, ['rev-parse', '--show-toplevel'], timeoutMs);
  return { repo_key: repoKey(remote), repo_label: repoLabel(remote), branch, root };
}
