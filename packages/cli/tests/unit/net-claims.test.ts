/**
 * File claims (PRD 9.1).
 *
 * Why it matters: two agents editing the same file should hear about it
 * before they collide, without either one revealing which repository or
 * file it is to anyone outside that repository.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimsFor, editedPaths, pathHash } from '../../src/lib/net/claims.js';

describe('editedPaths', () => {
  it.each([
    ['Claude Code Edit', { tool_name: 'Edit', tool_input: { file_path: '/r/src/a.ts', old_string: 'x' } }, ['/r/src/a.ts']],
    ['Claude Code MultiEdit', { tool_name: 'MultiEdit', tool_input: { file_path: '/r/b.ts', edits: [] } }, ['/r/b.ts']],
    ['Claude Code NotebookEdit', { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/r/n.ipynb' } }, ['/r/n.ipynb']],
    ['Codex apply_patch', { tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** Update File: src/x.py\n@@\n*** Add File: src/y.py\n*** End Patch' } }, ['src/x.py', 'src/y.py']],
    ['Cursor edit_file', { tool_name: 'edit_file', tool_input: { target_file: 'web/page.tsx' } }, ['web/page.tsx']],
    ['Gemini write_file', { tool_name: 'write_file', tool_input: { file_path: 'main.go', content: '...' } }, ['main.go']],
    ['Copilot camelCase', { toolName: 'edit', toolArgs: JSON.stringify({ path: 'lib/z.rb' }) }, ['lib/z.rb']],
  ])('%s', (_name, payload, expected) => {
    expect(editedPaths(payload as Record<string, unknown>)).toEqual(expected);
  });

  it('ignores tools that only read', () => {
    expect(editedPaths({ tool_name: 'Read', tool_input: { file_path: '/r/a.ts' } })).toEqual([]);
    expect(editedPaths({ tool_name: 'Bash', tool_input: { command: 'cat a.ts' } })).toEqual([]);
  });
});

describe('claimsFor', () => {
  const root = path.resolve('/work/repo');

  it('hashes repo-relative paths with the repo key so only the same repo can match them', () => {
    const [c] = claimsFor(['src/a.ts'], root, root, 'key1');
    expect(c).toEqual({ path_hash: pathHash('key1', 'src/a.ts') });
    expect(claimsFor([path.join(root, 'src/a.ts')], '/elsewhere', root, 'key1')[0].path_hash).toBe(c.path_hash);
    expect(claimsFor(['src/a.ts'], root, root, 'key2')[0].path_hash).not.toBe(c.path_hash);
  });

  it('sends the plaintext path only with share-paths', () => {
    expect(claimsFor(['src/a.ts'], root, root, 'k')[0]).not.toHaveProperty('path_label');
    expect(claimsFor(['src/a.ts'], root, root, 'k', true)[0].path_label).toBe('src/a.ts');
  });

  it('drops paths outside the repository', () => {
    expect(claimsFor(['/etc/passwd', '../other/x.ts'], root, root, 'k')).toEqual([]);
  });
});
