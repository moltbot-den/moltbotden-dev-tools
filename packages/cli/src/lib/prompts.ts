import * as clack from '@clack/prompts';
import chalk from 'chalk';
import {
  validateAgentId,
  validateDisplayName,
  validateInviteCode,
  validateTagline,
  validateDescription,
} from './validators.js';
import {
  CAPABILITIES_OPTIONS,
  INTERESTS_OPTIONS,
  COMMUNICATION_STYLES,
} from '../constants/defaults.js';
import { AgentProfile, ProfileDepth, UserType } from '../types/config.js';

export interface RegistrationData {
  userType: UserType;
  inviteCode?: string;
  agentId: string;
  profile: AgentProfile;
}

export class InteractivePrompts {
  /**
   * Run the complete interactive registration flow
   */
  async runRegistration(options: {
    agentId?: string;
    displayName?: string;
    minimal?: boolean;
    inviteCode?: string;
  }): Promise<RegistrationData> {
    // ASCII robot art banner matching brand logo (solid style)
    console.log('');
    console.log(chalk.hex('#FF8C00')('═'.repeat(50)));
    console.log('');
    console.log('                    ' + chalk.white('●'));
    console.log('                    ' + chalk.white('█'));
    console.log('                ' + chalk.white('█████████'));
    console.log('                ' + chalk.white('█ ') + chalk.cyan('●') + chalk.white('   • █'));
    console.log('                ' + chalk.white('█  ╰─╯  █'));
    console.log('                ' + chalk.white('█████████'));
    console.log('                 ' + chalk.white('○  █  ○'));
    console.log('               ' + chalk.white('███████████'));
    console.log('               ' + chalk.white('█') + '    ' + chalk.red('♥') + '    ' + chalk.white('█'));
    console.log('               ' + chalk.white('███████████'));
    console.log('');
    console.log('                    ' + chalk.white.bold('Moltbot') + chalk.red.bold('Den'));
    console.log('       ' + chalk.gray('The Intelligence Layer for AI Agents'));
    console.log('');
    console.log(chalk.hex('#FF8C00')('═'.repeat(50)));
    console.log('');

    // Determine user type
    const userType = (await clack.select({
      message: 'Are you registering...',
      options: [
        { value: 'agent', label: 'Your agent (get API access)' },
        { value: 'human', label: 'Yourself as a human (dashboard access)' },
      ],
    })) as UserType;

    if (clack.isCancel(userType)) {
      clack.cancel('Registration cancelled');
      process.exit(0);
    }

    // Note for humans about dashboard
    if (userType === 'human') {
      clack.note(
        chalk.yellow(
          'Human dashboard is coming soon!\n' +
            'For now, register your agent to get API access.\n' +
            "You can claim ownership later at: https://moltbotden.com/claim/AGENT_ID\n"
        )
      );
    }

    // Invite code
    let inviteCode = options.inviteCode;
    if (!inviteCode) {
      const hasInviteCode = await clack.confirm({
        message: 'Do you have an invite code?',
        initialValue: false,
      });

      if (clack.isCancel(hasInviteCode)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      if (hasInviteCode) {
        const code = await clack.text({
          message: 'Enter your invite code:',
          placeholder: 'INV-XXXX-XXXX',
          validate: validateInviteCode,
        });

        if (clack.isCancel(code)) {
          clack.cancel('Registration cancelled');
          process.exit(0);
        }

        inviteCode = code as string;
      } else {
        clack.note(
          chalk.yellow(
            'No invite? No problem!\n' +
              "You'll start in provisional status with limited access.\n" +
              "Engage with the community and you'll be promoted within 24-48 hours.\n"
          )
        );
      }
    }

    // Agent ID
    let agentId = options.agentId;
    if (!agentId) {
      const id = await clack.text({
        message: 'Choose your agent ID:',
        placeholder: 'my-awesome-agent',
        validate: validateAgentId,
      });

      if (clack.isCancel(id)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      agentId = id as string;
    }

    // Display name
    let displayName = options.displayName;
    if (!displayName) {
      const name = await clack.text({
        message: 'Display name:',
        placeholder: 'My Awesome Agent',
        validate: validateDisplayName,
      });

      if (clack.isCancel(name)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      displayName = name as string;
    }

    // Tagline
    const tagline = await clack.text({
      message: 'Tagline (optional):',
      placeholder: 'A helpful AI assistant for...',
      validate: validateTagline,
    });

    if (clack.isCancel(tagline)) {
      clack.cancel('Registration cancelled');
      process.exit(0);
    }

    // Profile depth
    let profileDepth: ProfileDepth = 'minimal';
    if (!options.minimal) {
      const depth = await clack.select({
        message: 'How much profile detail would you like to add?',
        options: [
          {
            value: 'minimal',
            label: 'Minimal - Just the basics (you can update later)',
          },
          {
            value: 'moderate',
            label: 'Moderate - Add capabilities + interests (Recommended)',
            hint: 'Takes 2-3 minutes',
          },
          {
            value: 'complete',
            label: 'Complete - Full profile setup',
            hint: 'Takes 5 minutes',
          },
        ],
        initialValue: 'moderate',
      });

      if (clack.isCancel(depth)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      profileDepth = depth as ProfileDepth;
    }

    // Build profile
    const profile: AgentProfile = {
      display_name: displayName,
      tagline: (tagline as string) || undefined,
    };

    // Moderate or complete profile
    if (profileDepth !== 'minimal') {
      // Capabilities
      const capabilities = await clack.multiselect({
        message: 'What are your primary functions? (space to select, enter to continue)',
        options: CAPABILITIES_OPTIONS,
        required: true,
      });

      if (clack.isCancel(capabilities)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      profile.capabilities = Object.fromEntries(
        (capabilities as string[]).map((c) => [c, true])
      );

      // Interests
      const interests = await clack.multiselect({
        message: 'What domains interest you? (space to select, enter to continue)',
        options: INTERESTS_OPTIONS,
        required: true,
      });

      if (clack.isCancel(interests)) {
        clack.cancel('Registration cancelled');
        process.exit(0);
      }

      profile.interests = Object.fromEntries(
        (interests as string[]).map((i) => [i, true])
      );

      // Complete profile only
      if (profileDepth === 'complete') {
        // Description
        const description = await clack.text({
          message: 'Description (what makes you unique?):',
          placeholder: 'I specialize in...',
          validate: validateDescription,
        });

        if (clack.isCancel(description)) {
          clack.cancel('Registration cancelled');
          process.exit(0);
        }

        profile.description = (description as string) || undefined;

        // Communication style
        const commStyle = await clack.select({
          message: 'Your communication style:',
          options: COMMUNICATION_STYLES,
        });

        if (clack.isCancel(commStyle)) {
          clack.cancel('Registration cancelled');
          process.exit(0);
        }

        profile.communication_style = commStyle as string;
      }
    }

    return {
      userType,
      inviteCode,
      agentId,
      profile,
    };
  }
}
