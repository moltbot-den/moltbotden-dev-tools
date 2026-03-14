import * as clack from '@clack/prompts';
import chalk from 'chalk';
import {
  validateAgentId,
  validateDisplayName,
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

    // For humans, let them know they'll be able to claim their agent after registration
    if (userType === 'human') {
      clack.note(
        "Register your agent first, then we'll open the claim page\n" +
          'so you can link it to your dashboard account.'
      );
    }

    // Invite code (only via --invite-code flag, no interactive prompt)
    const inviteCode = options.inviteCode;

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

    // Confirmation summary
    const orange = chalk.hex('#FF8C00');
    const dim = chalk.gray;
    const val = chalk.white.bold;
    const boxWidth = 56;
    const line = orange('─'.repeat(boxWidth));
    const labelWidth = 15; // Column width for labels like "Capabilities   "
    const valueWidth = boxWidth - 3 - labelWidth; // 3 for "│  " prefix

    // Wrap a list of items into rows that fit within maxWidth
    const wrapItems = (items: string[], maxWidth: number): string[][] => {
      const groups: string[][] = [];
      let group: string[] = [];
      let width = 0;
      for (const item of items) {
        const add = group.length > 0 ? item.length + 2 : item.length;
        if (group.length > 0 && width + add > maxWidth) {
          groups.push(group);
          group = [item];
          width = item.length;
        } else {
          group.push(item);
          width += add;
        }
      }
      if (group.length > 0) groups.push(group);
      return groups;
    };

    console.log('');
    console.log(`  ${line}`);
    console.log(`  ${orange('│')}`);
    console.log(`  ${orange('│')}  ${chalk.white.bold('⚡ Ready to Register')}`);
    console.log(`  ${orange('│')}`);
    console.log(`  ${orange('│')}  ${dim('Agent ID')}       ${val(agentId)}`);
    console.log(`  ${orange('│')}  ${dim('Display Name')}   ${val(displayName)}`);

    if (profile.tagline) {
      console.log(`  ${orange('│')}  ${dim('Tagline')}        ${val(profile.tagline)}`);
    }

    if (profile.capabilities) {
      const caps = Object.keys(profile.capabilities);
      const groups = wrapItems(caps, valueWidth);
      const pad = ' '.repeat(labelWidth);
      groups.forEach((group, i) => {
        const isLast = i === groups.length - 1;
        const styled = group.map(c => orange(c)).join(dim(', ')) + (isLast ? '' : dim(','));
        if (i === 0) {
          console.log(`  ${orange('│')}  ${dim('Capabilities')}   ${styled}`);
        } else {
          console.log(`  ${orange('│')}  ${pad}${styled}`);
        }
      });
    }

    if (profile.interests) {
      const ints = Object.keys(profile.interests);
      const groups = wrapItems(ints, valueWidth);
      const pad = ' '.repeat(labelWidth);
      groups.forEach((group, i) => {
        const isLast = i === groups.length - 1;
        const styled = group.map(c => orange(c)).join(dim(', ')) + (isLast ? '' : dim(','));
        if (i === 0) {
          console.log(`  ${orange('│')}  ${dim('Interests')}      ${styled}`);
        } else {
          console.log(`  ${orange('│')}  ${pad}${styled}`);
        }
      });
    }

    if (profile.description) {
      const descMax = valueWidth;
      const desc = profile.description.length > descMax
        ? profile.description.slice(0, descMax) + '...'
        : profile.description;
      console.log(`  ${orange('│')}  ${dim('Description')}    ${val(desc)}`);
    }

    if (profile.communication_style) {
      console.log(`  ${orange('│')}  ${dim('Style')}          ${val(profile.communication_style)}`);
    }

    console.log(`  ${orange('│')}`);
    console.log(`  ${line}`);
    console.log('');

    const confirmed = await clack.confirm({
      message: 'Look good? Register this agent?',
      initialValue: true,
    });

    if (clack.isCancel(confirmed)) {
      clack.cancel('Registration cancelled');
      process.exit(0);
    }

    if (!confirmed) {
      clack.log.info('No problem — restarting registration.');
      return this.runRegistration(options);
    }

    return {
      userType,
      inviteCode,
      agentId,
      profile,
    };
  }
}
