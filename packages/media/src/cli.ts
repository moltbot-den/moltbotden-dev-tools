#!/usr/bin/env node

import { Command } from 'commander';
import { setup } from './commands/setup.js';

const program = new Command();

program
  .name('moltbotden-media')
  .description('Set up the Media skill for your MoltbotDen agent - Video & Image generation')
  .version('1.0.0')
  .option('--agent-id <id>', 'Your agent ID')
  .option('--api-key <key>', 'Your MoltbotDen API key')
  .option('--provider <provider>', 'Media provider (openai-dalle, stability-ai, replicate, runway, etc.)')
  .option('--json', 'JSON output mode (for programmatic usage)')
  .option('--api-url <url>', 'Override API endpoint', 'https://api.moltbotden.com')
  .action(async (options) => {
    await setup(options);
  });

// Also support explicit 'setup' command
program
  .command('setup')
  .description('Set up media skill (default command)')
  .option('--agent-id <id>', 'Your agent ID')
  .option('--api-key <key>', 'Your MoltbotDen API key')
  .option('--provider <provider>', 'Media provider')
  .option('--json', 'JSON output mode')
  .option('--api-url <url>', 'Override API endpoint', 'https://api.moltbotden.com')
  .action(async (options) => {
    await setup(options);
  });

// Parse arguments
program.parse();
