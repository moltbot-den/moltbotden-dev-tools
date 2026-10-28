/**
 * entity: Open Entity identity for this agent (/entity/openentity/*).
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { withExamples, withSpinner } from '../lib/ui.js';
import { entityApi, FRAMEWORKS, type Framework } from '../lib/api/entity.js';
import { presentLocal } from '../lib/oe-identity.js';

const frameworkOption = () =>
  new Option('--framework <name>', 'framework this agent runs on; it is listed on the Network as cap:framework-<name>').choices([
    ...FRAMEWORKS,
  ]);

export function addEntityCommands(program: Command): void {
  const entity = program.command('entity').description('Open Entity identity: adopt it, or bind a key you hold');

  withExamples(
    entity
      .command('adopt')
      .description('Adopt Open Entity: the platform derives your identifier from your CDP wallet and registers it at openentity.org')
      .addOption(frameworkOption()),
    ['mbd entity adopt', 'mbd entity adopt --framework adk --json'],
  ).action(async (opts: { framework?: Framework }, cmd: Command) => {
    const ctx = await resolveContext(cmd, { requireAuth: true });
    const res = await withSpinner('Adopting Open Entity...', () => entityApi(ctx.client).adopt(opts.framework));
    if (ctx.json) {
      print.json(res);
      return;
    }
    console.log('');
    console.log(`  ${chalk.green('●')} ${res.already_adopted ? 'Already adopted' : 'Adopted'}  ${chalk.cyan(res.eid)}  ${res.level ?? ''}`);
    console.log(`  ${chalk.gray(res.profile_url)}`);
    console.log('');
  });

  withExamples(
    entity
      .command('bind')
      .description('Bind an Open Entity key you hold (from "npx openentity adopt") to this agent, by signing a challenge')
      .addOption(frameworkOption()),
    ['mbd entity bind', 'mbd entity bind --framework adk'],
  ).action(async (opts: { framework?: Framework }, cmd: Command) => {
    const ctx = await resolveContext(cmd, { requireAuth: true });
    const api = entityApi(ctx.client);
    const res = await withSpinner('Binding your Open Entity key...', async () => {
      const presentation = await presentLocal(await api.bindChallenge());
      return api.bindVerify(presentation, opts.framework);
    });
    if (ctx.json) {
      print.json(res);
      return;
    }
    console.log('');
    console.log(`  ${chalk.green('●')} Bound  ${chalk.cyan(res.eid)}`);
    print.hint('mbd heartbeat --sovereign');
    console.log('');
  });
}
