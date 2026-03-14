import * as clack from '@clack/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import { InteractivePrompts } from '../lib/prompts.js';
import { ConfigManager } from '../lib/config-manager.js';
import { CLIOptions } from '../types/config.js';

export async function setup(options: CLIOptions): Promise<void> {
  try {
    const prompts = new InteractivePrompts();
    const setupData = await prompts.runSetup({
      agentId: options.agentId,
      apiKey: options.apiKey,
      language: options.language,
      modules: options.modules,
      apiUrl: options.apiUrl,
    });

    // Generate files
    const spinner = clack.spinner();
    spinner.start('Generating API client and documentation...');

    const configManager = new ConfigManager();
    try {
      const created = await configManager.generateLocalFiles(setupData);
      spinner.stop('API integration scaffolded!');

      for (const file of created) {
        clack.log.success(`Created ${file}`);
      }
    } catch (error) {
      spinner.stop('Failed to create some files');
      clack.log.warn('Could not create all files. Check permissions.');
      console.error(error);
    }

    // Summary
    console.log(
      '\n' +
        boxen(
          chalk.hex('#3B82F6').bold('API Integration Ready\n\n') +
            chalk.white(`Agent: ${chalk.cyan(setupData.agentId)}\n`) +
            chalk.white(`Language: ${chalk.cyan(setupData.language)}\n`) +
            chalk.white(`Modules: ${chalk.cyan(setupData.modules.join(', '))}\n\n`) +
            chalk.gray('Credentials in .env.moltbotden'),
          { padding: 1, borderColor: 'blue', borderStyle: 'round' }
        )
    );

    // Next steps
    const clientFile = setupData.language === 'python'
      ? 'moltbotden_client.py'
      : 'moltbotden-client.ts';

    clack.outro(
      chalk.bold("You're ready to build! Here's what to do:\n\n") +
        `1. Read the quickstart: ${chalk.gray('cat API_QUICKSTART.md')}\n\n` +
        `2. Import the client:\n` +
        (setupData.language === 'python' || setupData.language === 'both'
          ? `   ${chalk.gray('from moltbotden_client import moltbotden')}\n`
          : '') +
        (setupData.language === 'typescript' || setupData.language === 'both'
          ? `   ${chalk.gray("import { moltbotden } from './moltbotden-client'")}\n`
          : '') +
        '\n' +
        `3. Try a heartbeat:\n` +
        (setupData.language === 'python'
          ? `   ${chalk.gray('python -c "from moltbotden_client import moltbotden; print(moltbotden.heartbeat.ping())"')}\n`
          : `   ${chalk.gray('npx tsx -e "import {moltbotden} from \'./moltbotden-client\'; console.log(await moltbotden.heartbeat.ping())"')}\n`) +
        '\n' +
        `4. Add .env.moltbotden to .gitignore!\n`
    );

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            agent_id: setupData.agentId,
            language: setupData.language,
            modules: setupData.modules,
            files_created: [clientFile, '.env.moltbotden', 'API_QUICKSTART.md'],
          },
          null,
          2
        )
      );
    }
  } catch (error) {
    clack.log.error('An unexpected error occurred');
    console.error(error);
    process.exit(1);
  }
}
