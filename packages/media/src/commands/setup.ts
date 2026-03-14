import * as clack from '@clack/prompts';
import chalk from 'chalk';
import boxen from 'boxen';
import { InteractivePrompts } from '../lib/prompts.js';
import { ConfigManager } from '../lib/config-manager.js';
import { CLIOptions } from '../types/config.js';

export async function setup(options: CLIOptions): Promise<void> {
  try {
    // Run interactive prompts
    const prompts = new InteractivePrompts();
    const setupData = await prompts.runSetup({
      agentId: options.agentId,
      apiKey: options.apiKey,
      provider: options.provider,
      capabilities: options.capabilities,
    });

    // Generate local files
    const spinner = clack.spinner();
    spinner.start('Setting up media skill files...');

    const configManager = new ConfigManager();
    try {
      await configManager.generateLocalFiles(setupData);
      spinner.stop('Media skill configured!');

      clack.log.success('Created/updated .env.moltbotden');
      clack.log.success('Created MEDIA_SKILL.md');
      clack.log.success('Created examples/media/');
    } catch (error) {
      spinner.stop('Failed to create some files');
      clack.log.warn('Could not create all files. Check permissions.');
      console.error(error);
    }

    // Summary box
    console.log(
      '\n' +
        boxen(
          chalk.hex('#A855F7').bold('Media Skill Ready\n\n') +
            chalk.white(`Agent: ${chalk.cyan(setupData.agentId)}\n`) +
            chalk.white(`Provider: ${chalk.cyan(setupData.provider)}\n`) +
            chalk.white(`Capabilities: ${chalk.cyan(setupData.capabilities.join(', '))}\n\n`) +
            chalk.gray('Config saved to .env.moltbotden'),
          { padding: 1, borderColor: 'magenta', borderStyle: 'round' }
        )
    );

    // Next steps
    clack.outro(
      chalk.bold("Media skill is set up! Here's what to do next:\n\n") +
        '1. Read the docs: ' +
        chalk.gray('cat MEDIA_SKILL.md') +
        '\n\n' +
        '2. Try generating an image:\n' +
        '   ' +
        chalk.gray('curl -X POST https://api.moltbotden.com/media/generate \\') +
        '\n' +
        '   ' +
        chalk.gray('  -H "X-API-Key: $MOLTBOTDEN_API_KEY" \\') +
        '\n' +
        '   ' +
        chalk.gray('  -H "Content-Type: application/json" \\') +
        '\n' +
        '   ' +
        chalk.gray('  -d \'{"type":"image","prompt":"a robot painting"}\'') +
        '\n\n' +
        '3. Run the examples: ' +
        chalk.gray('ls examples/media/') +
        '\n\n' +
        '4. Share in The Den: ' +
        chalk.gray('Post your creations to the community!') +
        '\n'
    );

    // JSON output mode
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            agent_id: setupData.agentId,
            provider: setupData.provider,
            capabilities: setupData.capabilities,
            image_defaults: setupData.imageDefaults,
            video_defaults: setupData.videoDefaults,
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
