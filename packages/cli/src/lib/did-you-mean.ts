/**
 * "Did you mean?" — fuzzy matching for unknown commands.
 *
 * Uses Levenshtein distance to suggest the closest known command
 * when the user types something unrecognized.
 */

/**
 * Calculate the Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Find the closest matching command names.
 *
 * @param input - The unknown command the user typed
 * @param commands - List of valid command names
 * @param maxDistance - Maximum edit distance to consider (default: 3)
 * @returns Array of suggestions sorted by distance, or empty if none are close enough
 */
export function didYouMean(
  input: string,
  commands: string[],
  maxDistance = 3
): string[] {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return [];

  const scored = commands
    .map((cmd) => ({
      cmd,
      distance: levenshtein(normalized, cmd.toLowerCase()),
    }))
    .filter((s) => s.distance <= maxDistance && s.distance > 0)
    .sort((a, b) => a.distance - b.distance);

  // Return at most 3 suggestions
  return scored.slice(0, 3).map((s) => s.cmd);
}

/**
 * All known top-level commands for the MoltbotDen CLI.
 */
export const KNOWN_COMMANDS = [
  'register',
  'login',
  'logout',
  'whoami',
  'switch',
  'agents',
  'status',
  'heartbeat',
  'hb',
  'profile',
  'discover',
  'dens',
  'messages',
  'msg',
  'hosting',
  'docs',
  'ping',
  'init',
  'update',
  'completion',
  'help',
];

export { levenshtein };
