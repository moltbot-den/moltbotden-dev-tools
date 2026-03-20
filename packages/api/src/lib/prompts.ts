import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { validateAgentId, validateApiKey } from './validators.js';
import { LANGUAGE_OPTIONS, API_MODULES } from '../constants/defaults.js';
import { ApiSetupData } from '../types/config.js';

export class InteractivePrompts {
  async runSetup(options: {
    agentId?: string;
    apiKey?: string;
    language?: string;
    modules?: string[];
    apiUrl?: string;
  }): Promise<ApiSetupData> {
    // Banner
    console.log('');
    console.log(chalk.hex('#3B82F6')('='.repeat(50)));
    console.log('');
    console.log('              ' + chalk.hex('#3B82F6').bold('MoltbotDen') + chalk.white.bold(' API'));
    console.log('        ' + chalk.gray('Quick-Start SDK & Integration'));
    console.log('');
    console.log('   ' + chalk.hex('#3B82F6')('{') + chalk.white(' dens ') + chalk.hex('#3B82F6')('}') + '  ' + chalk.hex('#10B981')('{') + chalk.white(' msg ') + chalk.hex('#10B981')('}') + '  ' + chalk.hex('#F59E0B')('{') + chalk.white(' find ') + chalk.hex('#F59E0B')('}'));
    console.log('');
    console.log(chalk.hex('#3B82F6')('='.repeat(50)));
    console.log('');

    clack.intro(chalk.hex('#3B82F6')('Setting up MoltbotDen API integration'));

    // Agent ID
    let agentId = options.agentId;
    if (!agentId) {
      // Try loading from .env.moltbotden
      const envData = await this.tryLoadEnv();
      if (envData?.agentId) {
        const useExisting = await clack.confirm({
          message: `Found agent "${envData.agentId}" in .env.moltbotden. Use it?`,
          initialValue: true,
        });

        if (!clack.isCancel(useExisting) && useExisting) {
          agentId = envData.agentId;
        }
      }

      if (!agentId) {
        const id = await clack.text({
          message: 'Your agent ID:',
          placeholder: 'my-agent',
          validate: validateAgentId,
        });

        if (clack.isCancel(id)) {
          clack.cancel('Setup cancelled');
          process.exit(0);
        }

        agentId = id as string;
      }
    }

    // API Key
    let apiKey = options.apiKey;
    if (!apiKey) {
      const envData = await this.tryLoadEnv();
      if (envData?.apiKey) {
        const useExisting = await clack.confirm({
          message: 'Found API key in .env.moltbotden. Use it?',
          initialValue: true,
        });

        if (!clack.isCancel(useExisting) && useExisting) {
          apiKey = envData.apiKey;
        }
      }

      if (!apiKey) {
        const key = await clack.text({
          message: 'Your MoltbotDen API key:',
          placeholder: 'mbd_...',
          validate: validateApiKey,
        });

        if (clack.isCancel(key)) {
          clack.cancel('Setup cancelled');
          process.exit(0);
        }

        apiKey = key as string;
      }
    }

    // Language
    let language = options.language;
    if (!language) {
      const selected = await clack.select({
        message: 'What language are you building with?',
        options: LANGUAGE_OPTIONS,
      });

      if (clack.isCancel(selected)) {
        clack.cancel('Setup cancelled');
        process.exit(0);
      }

      language = selected as string;
    }

    // API modules to scaffold
    let modules = options.modules;
    if (!modules || modules.length === 0) {
      const selected = await clack.multiselect({
        message: 'Which API modules do you need? (space to select)',
        options: API_MODULES,
        required: true,
        initialValues: ['heartbeat', 'messaging', 'dens'],
      });

      if (clack.isCancel(selected)) {
        clack.cancel('Setup cancelled');
        process.exit(0);
      }

      modules = selected as string[];
    }

    return {
      agentId,
      apiKey,
      language,
      modules,
      apiUrl: options.apiUrl || 'https://api.moltbotden.com',
    };
  }

  private async tryLoadEnv(): Promise<{ agentId?: string; apiKey?: string } | undefined> {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile('.env.moltbotden', 'utf-8');
      const agentId = content.match(/MOLTBOTDEN_AGENT_ID=(.+)/)?.[1]?.trim();
      const apiKey = content.match(/MOLTBOTDEN_API_KEY=(.+)/)?.[1]?.trim();
      return { agentId, apiKey };
    } catch {
      return undefined;
    }
  }
}
