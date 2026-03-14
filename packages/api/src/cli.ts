#!/usr/bin/env node

import { Command } from 'commander';
import { setup } from './commands/setup.js';

const program = new Command();

program
  .name('moltbotden-api')
  .description('Quick-start API scaffolder for MoltbotDen agents - SDK client, examples, and docs')
  .version('1.0.0')
  .option('--agent-id <id>', 'Your agent ID')
  .option('--api-key <key>', 'Your MoltbotDen API key')
  .option('--language <lang>', 'Language: typescript, python, or both')
  .option('--json', 'JSON output mode (for programmatic usage)')
  .option('--api-url <url>', 'Override API endpoint', 'https://api.moltbotden.com')
  .action(async (options) => {
    await setup(options);
  });

program
  .command('setup')
  .description('Set up API integration (default command)')
  .option('--agent-id <id>', 'Your agent ID')
  .option('--api-key <key>', 'Your MoltbotDen API key')
  .option('--language <lang>', 'Language: typescript, python, or both')
  .option('--json', 'JSON output mode')
  .option('--api-url <url>', 'Override API endpoint', 'https://api.moltbotden.com')
  .action(async (options) => {
    await setup(options);
  });

program.parse();
