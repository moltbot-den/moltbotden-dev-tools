/**
 * Unified output formatting for the MoltbotDen CLI.
 *
 * Brand palette:
 *   Primary (orange): #FF8C00
 *   Success (green):  #22c55e  — chalk.green
 *   Error (red):      #ef4444  — chalk.red
 *   Warning (amber):  #f59e0b  — chalk.yellow
 *   Info (cyan):      #06b6d4  — chalk.cyan
 *   Muted (gray):     #6b7280  — chalk.gray
 *
 * Status-to-color mapping for resources (VMs, DBs, etc.):
 *   running / active / ready / healthy  → green ●
 *   stopped / idle                      → yellow ●
 *   pending / provisioning / starting / stopping → blue ●
 *   error / failed / degraded          → red ●
 *   terminated / deleted / released    → gray ●
 */

import chalk from 'chalk';

// ─── Brand Colors ─────────────────────────────────────────────────────────────

const BRAND = chalk.hex('#FF8C00');
const SUCCESS = chalk.green;
const ERROR = chalk.red;
const WARN = chalk.yellow;
const INFO = chalk.cyan;
const MUTED = chalk.gray;
const BOLD = chalk.bold;
const DIM = chalk.dim;

// ─── Status Badges ────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, (text: string) => string> = {
  // Green states
  running: (t) => chalk.green(`● ${t}`),
  active: (t) => chalk.green(`● ${t}`),
  ready: (t) => chalk.green(`● ${t}`),
  healthy: (t) => chalk.green(`● ${t}`),
  verified: (t) => chalk.green(`✓ ${t}`),
  // Yellow states
  stopped: (t) => chalk.yellow(`● ${t}`),
  idle: (t) => chalk.yellow(`● ${t}`),
  suspended: (t) => chalk.yellow(`● ${t}`),
  // Blue states
  pending: (t) => chalk.blue(`● ${t}`),
  provisioning: (t) => chalk.blue(`● ${t}`),
  starting: (t) => chalk.blue(`● ${t}`),
  stopping: (t) => chalk.blue(`● ${t}`),
  rebuilding: (t) => chalk.blue(`● ${t}`),
  // Red states
  error: (t) => chalk.red(`● ${t}`),
  failed: (t) => chalk.red(`● ${t}`),
  degraded: (t) => chalk.red(`● ${t}`),
  // Gray states
  terminated: (t) => chalk.gray(`● ${t}`),
  deleted: (t) => chalk.gray(`● ${t}`),
  released: (t) => chalk.gray(`● ${t}`),
  provisional: (t) => chalk.yellow(`● ${t}`),
};

export function statusBadge(status: string): string {
  const normalised = status.toLowerCase();
  const fn = STATUS_MAP[normalised];
  if (fn) return fn(status);
  return MUTED(`● ${status}`);
}

// ─── Table Renderer ───────────────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  key?: string;
  width?: number;
  align?: 'left' | 'right';
  format?: (val: unknown, row: unknown) => string;
}

function pad(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  // Strip ANSI codes for length calculation
  const visible = str.replace(/\x1B\[[0-9;]*m/g, '');
  const diff = width - visible.length;
  if (diff <= 0) return str;
  if (align === 'right') return ' '.repeat(diff) + str;
  return str + ' '.repeat(diff);
}

export function renderTable(
  columns: TableColumn[],
  rows: Record<string, unknown>[],
  options: { indent?: number } = {}
): void {
  const indent = ' '.repeat(options.indent ?? 2);

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    let maxLen = col.width ?? headerLen;
    for (const row of rows) {
      const raw = col.format
        ? col.format(col.key ? row[col.key] : row, row)
        : String(col.key ? (row[col.key] ?? '–') : '');
      const visible = raw.replace(/\x1B\[[0-9;]*m/g, '');
      if (visible.length > maxLen) maxLen = visible.length;
    }
    return maxLen;
  });

  // Header row
  const headerLine = columns
    .map((col, i) => pad(BOLD(col.header), widths[i] + BOLD(col.header).length - col.header.length))
    .join('  ');
  console.log(indent + MUTED(headerLine));

  // Separator
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  console.log(indent + MUTED(sep));

  // Data rows
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const raw = col.format
        ? col.format(col.key ? row[col.key] : row, row)
        : String(col.key ? (row[col.key] ?? MUTED('–')) : '');
      return pad(raw, widths[i], col.align);
    });
    console.log(indent + cells.join('  '));
  }
}

// ─── Key-Value Display ────────────────────────────────────────────────────────

export function renderKeyValue(
  pairs: { label: string; value: string | undefined | null }[],
  options: { indent?: number; labelWidth?: number } = {}
): void {
  const indent = ' '.repeat(options.indent ?? 2);
  const maxLabel = options.labelWidth ?? Math.max(...pairs.map((p) => p.label.length));

  for (const { label, value } of pairs) {
    if (value === undefined || value === null) continue;
    const paddedLabel = label.padEnd(maxLabel);
    console.log(`${indent}${MUTED(paddedLabel)}  ${value}`);
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function renderBanner(): void {
  console.log('');
  console.log(BRAND('═'.repeat(52)));
  console.log('');
  console.log('                     ' + chalk.white('●'));
  console.log('                     ' + chalk.white('█'));
  console.log('                 ' + chalk.white('█████████'));
  console.log('                 ' + chalk.white('█ ') + chalk.cyan('●') + chalk.white('   • █'));
  console.log('                 ' + chalk.white('█  ╰─╯  █'));
  console.log('                 ' + chalk.white('█████████'));
  console.log('                ' + chalk.white('███████████'));
  console.log('                ' + chalk.white('█') + '    ' + chalk.red('♥') + '    ' + chalk.white('█'));
  console.log('                ' + chalk.white('███████████'));
  console.log('');
  console.log('                     ' + chalk.white.bold('Moltbot') + chalk.red.bold('Den'));
  console.log('        ' + MUTED('The Intelligence Layer for AI Agents'));
  console.log('');
  console.log(BRAND('═'.repeat(52)));
  console.log('');
}

// ─── Section Header ───────────────────────────────────────────────────────────

export function renderHeader(title: string, subtitle?: string): void {
  console.log('');
  console.log(BOLD(title));
  if (subtitle) console.log(MUTED(subtitle));
}

// ─── Core print object ────────────────────────────────────────────────────────

export const print = {
  success(msg: string): void {
    console.log(SUCCESS(`  ✓ ${msg}`));
  },

  error(msg: string): void {
    console.error(ERROR(`  ✗ ${msg}`));
  },

  warn(msg: string): void {
    console.log(WARN(`  ⚠ ${msg}`));
  },

  info(msg: string): void {
    console.log(INFO(`  → ${msg}`));
  },

  hint(msg: string): void {
    // Indent each line of a multi-line hint
    const lines = msg.split('\n').map((l) => `    ${l}`).join('\n');
    console.log(MUTED(lines));
  },

  divider(width = 52): void {
    console.log(MUTED('  ' + '─'.repeat(width)));
  },

  spacer(): void {
    console.log('');
  },

  header(title: string, subtitle?: string): void {
    renderHeader(title, subtitle);
  },

  /** Render key=value pairs with aligned labels */
  keyValue(
    pairs: { label: string; value: string | undefined | null }[],
    opts: { indent?: number; labelWidth?: number } = {}
  ): void {
    renderKeyValue(pairs, opts);
  },

  /** Render a clean table */
  table(
    columns: TableColumn[],
    rows: Record<string, unknown>[],
    opts: { indent?: number; emptyMsg?: string } = {}
  ): void {
    if (rows.length === 0) {
      console.log(MUTED(`  ${opts.emptyMsg ?? 'No results found.'}`));
      return;
    }
    renderTable(columns, rows, opts);
  },

  /** Pretty print JSON */
  json(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  },

  /** Empty state with optional action hint */
  empty(msg: string, hint?: string): void {
    console.log('');
    console.log(MUTED(`  ${msg}`));
    if (hint) console.log(INFO(`  → ${hint}`));
    console.log('');
  },

  /** Inline status badge */
  badge: statusBadge,

  banner: renderBanner,

  /** Format a currency amount from cents */
  cents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  },

  /** Highlight a command or code snippet */
  code(text: string): string {
    return chalk.cyan(text);
  },

  /** Format a relative timestamp */
  relativeTime(isoString: string): string {
    try {
      const ms = Date.now() - new Date(isoString).getTime();
      const secs = Math.floor(ms / 1000);
      if (secs < 60) return 'just now';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 30) return `${days}d ago`;
      return new Date(isoString).toLocaleDateString();
    } catch {
      return isoString;
    }
  },

  /** Format uptime from seconds */
  uptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 && d === 0) parts.push(`${m}m`);
    return parts.join(' ') || '<1m';
  },

  /** Output either human-readable or JSON depending on mode */
  output(jsonMode: boolean, data: unknown, humanFn: () => void): void {
    if (jsonMode) {
      this.json(data);
    } else {
      humanFn();
    }
  },
};

// ─── Re-export brand chalk references ─────────────────────────────────────────
export { BRAND, SUCCESS, ERROR, WARN, INFO, MUTED, BOLD, DIM };
