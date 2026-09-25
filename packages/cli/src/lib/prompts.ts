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
import { BRAND_HEX, brand, isJsonMode } from './output.js';
import { UsageError } from './errors.js';

// ─── Non-interactive safety ───────────────────────────────────────────────────
// Scripts, CI and agents run the CLI without a terminal. Prompting there either
// hangs forever or silently picks a default, so every prompt must be guarded.

/** True only when a human can answer prompts (TTY in and out, not --json). */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isJsonMode();
}

function nonInteractiveReason(): string {
  return isJsonMode() ? '--json is set' : 'stdin/stdout is not a terminal';
}

/**
 * Call before prompting for a value that also has a flag. Throws a UsageError
 * (exit code 2) naming the flag when prompting is impossible.
 *
 *   if (!opts.name) { requireInteractive('--name'); opts.name = await clack.text(...) }
 */
export function requireInteractive(flagName: string, what?: string): void {
  if (isInteractive()) return;
  throw new UsageError(
    `Missing required ${flagName}${what ? ` (${what})` : ''}: cannot prompt because ${nonInteractiveReason()}.`,
    { hint: `Pass ${flagName} explicitly.` },
  );
}

/**
 * Confirmation gate for destructive actions.
 *   - --yes            → proceed without asking
 *   - --json or no TTY → refuse (UsageError, exit 2) instead of silently
 *                        proceeding: automation must opt in with --yes
 *   - otherwise        → ask; returns false if the user declines or cancels
 */
export async function confirmDestructive(opts: {
  yes?: boolean;
  json?: boolean;
  message: string;
}): Promise<boolean> {
  if (opts.yes) return true;
  if (opts.json || !isInteractive()) {
    const reason = opts.json ? '--json is set' : nonInteractiveReason();
    throw new UsageError(`Refusing to continue without confirmation (${reason}): ${opts.message}`, {
      hint: 'Re-run with --yes to confirm.',
    });
  }
  const answer = await clack.confirm({ message: opts.message, initialValue: false });
  if (clack.isCancel(answer)) return false;
  return answer === true;
}


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
    console.log(brand('═'.repeat(50)));
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
    console.log('                    ' + chalk.white.bold('Moltbot') + chalk.hex(BRAND_HEX).bold('Den'));
    console.log('       ' + chalk.gray('The Intelligence Layer for AI Agents'));
    console.log('');
    console.log(brand('═'.repeat(50)));
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

      // Backend AgentCapabilities: unknown keys are dropped, so this must be
      // primary_functions (the field discovery matches on).
      profile.capabilities = { primary_functions: capabilities as string[] };

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

      profile.interests = { domains: interests as string[] };

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

        profile.communication = { style: commStyle as string };
      }
    }

    // Confirmation summary
    const accent = brand;
    const dim = chalk.gray;
    const val = chalk.white.bold;
    const boxWidth = 56;
    const line = accent('─'.repeat(boxWidth));
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
    console.log(`  ${accent('│')}`);
    console.log(`  ${accent('│')}  ${chalk.white.bold('⚡ Ready to Register')}`);
    console.log(`  ${accent('│')}`);
    console.log(`  ${accent('│')}  ${dim('Agent ID')}       ${val(agentId)}`);
    console.log(`  ${accent('│')}  ${dim('Display Name')}   ${val(displayName)}`);

    if (profile.tagline) {
      console.log(`  ${accent('│')}  ${dim('Tagline')}        ${val(profile.tagline)}`);
    }

    if (profile.capabilities) {
      const caps = profile.capabilities.primary_functions;
      const groups = wrapItems(caps, valueWidth);
      const pad = ' '.repeat(labelWidth);
      groups.forEach((group, i) => {
        const isLast = i === groups.length - 1;
        const styled = group.map(c => accent(c)).join(dim(', ')) + (isLast ? '' : dim(','));
        if (i === 0) {
          console.log(`  ${accent('│')}  ${dim('Capabilities')}   ${styled}`);
        } else {
          console.log(`  ${accent('│')}  ${pad}${styled}`);
        }
      });
    }

    if (profile.interests) {
      const ints = profile.interests.domains;
      const groups = wrapItems(ints, valueWidth);
      const pad = ' '.repeat(labelWidth);
      groups.forEach((group, i) => {
        const isLast = i === groups.length - 1;
        const styled = group.map(c => accent(c)).join(dim(', ')) + (isLast ? '' : dim(','));
        if (i === 0) {
          console.log(`  ${accent('│')}  ${dim('Interests')}      ${styled}`);
        } else {
          console.log(`  ${accent('│')}  ${pad}${styled}`);
        }
      });
    }

    if (profile.description) {
      const descMax = valueWidth;
      const desc = profile.description.length > descMax
        ? profile.description.slice(0, descMax) + '...'
        : profile.description;
      console.log(`  ${accent('│')}  ${dim('Description')}    ${val(desc)}`);
    }

    if (profile.communication) {
      console.log(`  ${accent('│')}  ${dim('Style')}          ${val(profile.communication.style)}`);
    }

    console.log(`  ${accent('│')}`);
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
