import * as clack from '@clack/prompts';
import chalk from 'chalk';
import {
  validateAgentId,
  validateApiKey,
} from './validators.js';
import {
  MEDIA_CAPABILITIES,
  SUPPORTED_PROVIDERS,
  IMAGE_FORMATS,
  VIDEO_FORMATS,
} from '../constants/defaults.js';
import { MediaSkillConfig, ImageDefaults, VideoDefaults } from '../types/config.js';

export interface MediaSetupData {
  agentId: string;
  apiKey: string;
  provider: string;
  capabilities: string[];
  imageDefaults: ImageDefaults;
  videoDefaults: VideoDefaults;
}

export class InteractivePrompts {
  /**
   * Run the complete interactive media skill setup flow
   */
  async runSetup(options: {
    agentId?: string;
    apiKey?: string;
    provider?: string;
    capabilities?: string[];
  }): Promise<MediaSetupData> {
    // Banner
    console.log('');
    console.log(chalk.hex('#8B5CF6')('='.repeat(50)));
    console.log('');
    console.log('              ' + chalk.hex('#A855F7').bold('MoltbotDen') + chalk.white.bold(' Media'));
    console.log('        ' + chalk.gray('Video & Image Generation Skill'));
    console.log('');
    console.log('   ' + chalk.hex('#8B5CF6')('[') + chalk.white(' IMG ') + chalk.hex('#8B5CF6')(']') + '  ' + chalk.hex('#EC4899')('[') + chalk.white(' VID ') + chalk.hex('#EC4899')(']') + '  ' + chalk.hex('#F59E0B')('[') + chalk.white(' GEN ') + chalk.hex('#F59E0B')(']'));
    console.log('');
    console.log(chalk.hex('#8B5CF6')('='.repeat(50)));
    console.log('');

    clack.intro(chalk.hex('#A855F7')('Setting up media skill for your agent'));

    // Agent ID
    let agentId = options.agentId;
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

    // API Key
    let apiKey = options.apiKey;
    if (!apiKey) {
      // Try loading from .env.moltbotden
      const envKey = await this.tryLoadApiKey();

      if (envKey) {
        const useExisting = await clack.confirm({
          message: `Found API key in .env.moltbotden. Use it?`,
          initialValue: true,
        });

        if (!clack.isCancel(useExisting) && useExisting) {
          apiKey = envKey;
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

    // Provider selection
    let provider = options.provider;
    if (!provider) {
      const selected = await clack.select({
        message: 'Which media provider will your agent use?',
        options: SUPPORTED_PROVIDERS,
      });

      if (clack.isCancel(selected)) {
        clack.cancel('Setup cancelled');
        process.exit(0);
      }

      provider = selected as string;
    }

    // Capabilities
    let capabilities = options.capabilities;
    if (!capabilities || capabilities.length === 0) {
      const selected = await clack.multiselect({
        message: 'What media capabilities does your agent support? (space to select)',
        options: MEDIA_CAPABILITIES,
        required: true,
      });

      if (clack.isCancel(selected)) {
        clack.cancel('Setup cancelled');
        process.exit(0);
      }

      capabilities = selected as string[];
    }

    // Image defaults (if image capability selected)
    const hasImageCap = capabilities.some(c =>
      ['image-generation', 'image-editing', 'thumbnail-generation', 'avatar-creation', 'style-transfer', 'upscaling'].includes(c)
    );

    let imageDefaults: ImageDefaults = {
      format: 'png',
      width: 1024,
      height: 1024,
      quality: 90,
    };

    if (hasImageCap) {
      const configureImages = await clack.confirm({
        message: 'Configure image defaults? (or use 1024x1024 PNG)',
        initialValue: false,
      });

      if (!clack.isCancel(configureImages) && configureImages) {
        const format = await clack.select({
          message: 'Default image format:',
          options: IMAGE_FORMATS,
          initialValue: 'png',
        });

        if (!clack.isCancel(format)) {
          imageDefaults.format = format as string;
        }

        const size = await clack.select({
          message: 'Default image size:',
          options: [
            { value: '512x512', label: '512x512 (Fast, small)' },
            { value: '1024x1024', label: '1024x1024 (Standard)' },
            { value: '1024x1792', label: '1024x1792 (Portrait)' },
            { value: '1792x1024', label: '1792x1024 (Landscape)' },
          ],
          initialValue: '1024x1024',
        });

        if (!clack.isCancel(size)) {
          const [w, h] = (size as string).split('x').map(Number);
          imageDefaults.width = w;
          imageDefaults.height = h;
        }
      }
    }

    // Video defaults (if video capability selected)
    const hasVideoCap = capabilities.some(c =>
      ['video-generation', 'video-editing'].includes(c)
    );

    let videoDefaults: VideoDefaults = {
      format: 'mp4',
      width: 1280,
      height: 720,
      fps: 24,
      duration_seconds: 10,
    };

    if (hasVideoCap) {
      const configureVideo = await clack.confirm({
        message: 'Configure video defaults? (or use 1280x720 MP4 @ 24fps)',
        initialValue: false,
      });

      if (!clack.isCancel(configureVideo) && configureVideo) {
        const format = await clack.select({
          message: 'Default video format:',
          options: VIDEO_FORMATS,
          initialValue: 'mp4',
        });

        if (!clack.isCancel(format)) {
          videoDefaults.format = format as string;
        }

        const resolution = await clack.select({
          message: 'Default video resolution:',
          options: [
            { value: '640x480', label: '480p (Fast generation)' },
            { value: '1280x720', label: '720p (Standard)' },
            { value: '1920x1080', label: '1080p (High quality)' },
          ],
          initialValue: '1280x720',
        });

        if (!clack.isCancel(resolution)) {
          const [w, h] = (resolution as string).split('x').map(Number);
          videoDefaults.width = w;
          videoDefaults.height = h;
        }
      }
    }

    return {
      agentId,
      apiKey,
      provider,
      capabilities,
      imageDefaults,
      videoDefaults,
    };
  }

  /**
   * Try to load API key from existing .env.moltbotden
   */
  private async tryLoadApiKey(): Promise<string | undefined> {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile('.env.moltbotden', 'utf-8');
      const match = content.match(/MOLTBOTDEN_API_KEY=(.+)/);
      return match?.[1]?.trim();
    } catch {
      return undefined;
    }
  }
}
