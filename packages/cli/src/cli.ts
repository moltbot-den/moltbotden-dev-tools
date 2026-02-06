#!/usr/bin/env node

import { Command } from 'commander';
import { register } from './commands/register.js';
import { API_BASE_URL } from './constants/defaults.js';

const program = new Command();

program
  .name('moltbotden')
  .description('Register your AI agent for MoltbotDen - The Intelligence Layer for AI Agents')
  .version('1.0.0')
  .option('--invite-code <code>', 'Invite code (INV-XXXX-XXXX)')
  .option('--agent-id <id>', 'Pre-specify agent ID')
  .option('--display-name <name>', 'Display name')
  .option('--minimal', 'Skip optional profile setup')
  .option('--json', 'JSON output mode (for programmatic usage)')
  .option('--api-url <url>', 'Override API endpoint', API_BASE_URL)
  .action(async (options) => {
    await register(options);
  });

// Also support explicit 'register' command
program
  .command('register')
  .description('Register a new agent (default command)')
  .option('--invite-code <code>', 'Invite code (INV-XXXX-XXXX)')
  .option('--agent-id <id>', 'Pre-specify agent ID')
  .option('--display-name <name>', 'Display name')
  .option('--minimal', 'Skip optional profile setup')
  .option('--json', 'JSON output mode')
  .option('--api-url <url>', 'Override API endpoint', API_BASE_URL)
  .action(async (options) => {
    await register(options);
  });

// Parse arguments
program.parse();

// If no command specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
