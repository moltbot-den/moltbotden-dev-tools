/**
 * E2E tests for the MoltbotDen CLI.
 *
 * These tests execute the actual built CLI binary and verify:
 *   - Command output format
 *   - Exit codes
 *   - JSON mode output
 *   - Error handling
 *   - Help text
 *   - Version output
 *
 * NOTE: These test against the REAL API (api.moltbotden.com) for read-only
 * operations (ping, version, help). Mutating operations (register, etc.)
 * use --json mode with intentionally invalid data to test error paths.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, ExecSyncOptions } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js');

const exec = (args: string, opts: ExecSyncOptions = {}): string => {
  try {
    return execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', MBD_NO_UPDATE_CHECK: '1' },
      ...opts,
    }).trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    // Return combined output for assertion
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
};

const execWithCode = (args: string): { output: string; code: number } => {
  try {
    const output = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', MBD_NO_UPDATE_CHECK: '1' },
    }).trim();
    return { output, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      output: ((e.stdout ?? '') + (e.stderr ?? '')).trim(),
      code: e.status ?? 1,
    };
  }
};

const execJson = (args: string): Record<string, unknown> => {
  const output = exec(`--json ${args}`);
  return JSON.parse(output) as Record<string, unknown>;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CLI E2E', () => {
  beforeAll(() => {
    // Verify the CLI is built
    try {
      execSync(`node ${CLI_PATH} --version`, { encoding: 'utf-8', timeout: 5000 });
    } catch {
      throw new Error('CLI not built. Run `npm run build` first.');
    }
  });

  // ─── Version & Help ──────────────────────────────────────────────────────

  describe('version', () => {
    it('should output version number with -v', () => {
      const output = exec('-v');
      expect(output).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should output version number with --version', () => {
      const output = exec('--version');
      expect(output).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('help', () => {
    it('should show help with --help', () => {
      const output = exec('--help');
      expect(output).toContain('MoltbotDen CLI');
      expect(output).toContain('register');
      expect(output).toContain('login');
      expect(output).toContain('heartbeat');
      expect(output).toContain('hosting');
      expect(output).toContain('messages');
      expect(output).toContain('init');
      expect(output).toContain('update');
      expect(output).toContain('ping');
    });

    it('should show register help', () => {
      const output = exec('register --help');
      expect(output).toContain('Register a new AI agent');
      expect(output).toContain('--invite-code');
      expect(output).toContain('--agent-id');
      expect(output).toContain('--display-name');
      expect(output).toContain('--minimal');
    });

    it('should show hosting help', () => {
      const output = exec('hosting --help');
      expect(output).toContain('vm');
      expect(output).toContain('db');
      expect(output).toContain('storage');
      expect(output).toContain('openclaw');
      expect(output).toContain('domains');
      expect(output).toContain('billing');
    });

    it('should show messages help', () => {
      const output = exec('messages --help');
      expect(output).toContain('list');
      expect(output).toContain('read');
      expect(output).toContain('send');
    });

    it('should show init help', () => {
      const output = exec('init --help');
      expect(output).toContain('Initialize');
      expect(output).toContain('--force');
    });

    it('should show update help', () => {
      const output = exec('update --help');
      expect(output).toContain('Update');
      expect(output).toContain('--check');
    });

    it('should show completion help', () => {
      const output = exec('completion --help');
      expect(output).toContain('bash');
      expect(output).toContain('zsh');
      expect(output).toContain('fish');
    });

    it('should show discover subcommand help', () => {
      const output = exec('discover agents --help');
      expect(output).toContain('--limit');
      expect(output).toContain('--page');
      expect(output).toContain('--per-page');
    });
  });

  // ─── Ping ────────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('should return JSON with ok=true for healthy API', () => {
      const result = execJson('ping');
      expect(result.ok).toBe(true);
      expect(result.latency_ms).toBeDefined();
      expect(typeof result.latency_ms).toBe('number');
    });

    it('should include status in response', () => {
      const result = execJson('ping');
      expect(result.status).toBeDefined();
    });
  });

  // ─── JSON Mode Error Paths ───────────────────────────────────────────────

  describe('json mode', () => {
    it('should require --agent-id and --display-name for register', () => {
      const result = execJson('register');
      expect(result.success).toBe(false);
      expect(result.error).toContain('--agent-id');
    });

    it('should return valid JSON for whoami', () => {
      const result = execJson('whoami');
      // May be authenticated (if ~/.moltbotden/config.json exists) or not
      expect(typeof result.authenticated).toBe('boolean');
      if (result.authenticated) {
        expect(result.agent_id).toBeDefined();
        expect(result.source).toBeDefined();
      }
    });
  });

  // ─── Update Check ────────────────────────────────────────────────────────

  describe('update', () => {
    it('should check for updates with --check', () => {
      const result = execJson('update --check');
      expect(result.current_version).toBeDefined();
      expect(result.latest_version).toBeDefined();
      expect(typeof result.up_to_date).toBe('boolean');
    });
  });

  // ─── Completion ──────────────────────────────────────────────────────────

  describe('completion', () => {
    it('should output bash completion script', () => {
      const output = exec('completion bash');
      expect(output).toContain('_mbd_completions');
      expect(output).toContain('complete -F');
    });

    it('should output zsh completion script', () => {
      const output = exec('completion zsh');
      expect(output).toContain('compdef');
      expect(output).toContain('_mbd');
    });

    it('should output fish completion script', () => {
      const output = exec('completion fish');
      expect(output).toContain('complete -c mbd');
    });
  });

  // ─── Verbose Mode ─────────────────────────────────────────────────────────

  describe('verbose', () => {
    it('should include debug output in stderr with --verbose', () => {
      // Verbose output goes to stderr, command output to stdout
      try {
        const output = execSync(`node ${CLI_PATH} --verbose --json ping 2>&1`, {
          encoding: 'utf-8',
          timeout: 30_000,
          env: { ...process.env, NO_COLOR: '1', MBD_NO_UPDATE_CHECK: '1' },
        });
        // Should contain debug prefix
        expect(output).toContain('cli');
      } catch (err: unknown) {
        // Even if it exits non-zero, check the output
        const e = err as { stdout?: string; stderr?: string };
        const combined = (e.stdout ?? '') + (e.stderr ?? '');
        expect(combined).toContain('cli');
      }
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should show auth error for status without credentials', () => {
      const { output, code } = execWithCode('--json status --api-key invalid_key_123');
      // Should fail with auth error or network error
      expect(code).not.toBe(0);
    });

    it('should handle invalid API URL gracefully', () => {
      const { output, code } = execWithCode('--json ping --api-url http://localhost:1');
      expect(code).not.toBe(0);
      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(false);
    });
  });
});
