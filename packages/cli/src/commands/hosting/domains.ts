/**
 * Hosting domain commands: list, add, show, dns, remove
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';

export function addDomainCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const domainsCmd = parent
    .command('domains')
    .alias('domain')
    .description('Manage custom domains');

  // ─── list ─────────────────────────────────────────────────────────────────────
  domainsCmd
    .command('list')
    .alias('ls')
    .description('List your registered domains')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading domains...');

      let result: Awaited<ReturnType<typeof client.listDomains>>;
      try {
        result = await client.listDomains();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to list domains');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(result)); return; }

      const { domains } = result;
      print.header(`Domains  ${chalk.gray(`(${domains.length})`)}`);
      console.log('');

      if (domains.length === 0) {
        print.empty(
          'No domains registered yet',
          'Add one with:  mbd hosting domains add <domain>'
        );
        return;
      }

      print.table(
        [
          { header: 'DOMAIN',   key: 'domain',      width: 30, format: (v) => chalk.cyan(String(v)) },
          { header: 'STATUS',   key: 'status',      width: 24, format: (v) => statusBadge(String(v)) },
          { header: 'VERIFIED', key: 'verified',    width: 10, format: (v) => v ? chalk.green('✓ yes') : chalk.yellow('✗ no') },
          { header: 'ADDED',    key: 'created_at',             format: (v) => chalk.gray(print.relativeTime(String(v))) },
        ],
        domains as Record<string, unknown>[]
      );

      console.log('');
      print.hint(`Show DNS records:  mbd hosting domains show <id>`);
      print.hint(`Add a domain:      mbd hosting domains add <domain>`);
      console.log('');
    });

  // ─── add ──────────────────────────────────────────────────────────────────────
  domainsCmd
    .command('add [domain]')
    .description('Add a custom domain')
    .action(async (domainArg?: string) => {
      const client = await getClient();
      const json = jsonMode();

      let domain = domainArg ?? '';

      if (!domain && !json) {
        const d = await clack.text({
          message: 'Domain name:',
          placeholder: 'api.myagent.com',
          validate: (v) => {
            if (!v || v.trim().length < 3) return 'Enter a valid domain name';
            if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v.trim())) {
              return 'Must be a valid domain (e.g. api.myagent.com)';
            }
          },
        });
        if (clack.isCancel(d)) { clack.cancel('Cancelled'); process.exit(0); }
        domain = (d as string).trim();
      }

      if (!domain) {
        print.error('Domain name is required');
        process.exit(1);
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Adding domain ${chalk.cyan(domain)}...`);

      try {
        const result = await client.addDomain(domain);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Domain ${chalk.cyan(domain)} added`);
          console.log('');

          if (result.nameservers && result.nameservers.length > 0) {
            console.log('  ' + chalk.bold('Update your DNS — point these nameservers at your registrar:'));
            console.log('');
            for (const ns of result.nameservers) {
              console.log('  ' + chalk.cyan(ns));
            }
          } else if (result.dns_records && result.dns_records.length > 0) {
            console.log('  ' + chalk.bold('Add these DNS records at your domain registrar:'));
            console.log('');
            for (const rec of result.dns_records) {
              console.log(`  ${chalk.gray(rec.type.padEnd(6))} ${chalk.white(rec.name.padEnd(30))} ${chalk.cyan(rec.value)}`);
            }
          }

          console.log('');
          print.info('DNS changes can take up to 48 hours to propagate');
          print.hint(`Check status:  mbd hosting domains show ${result.id}`);
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to add domain');
        process.exit(1);
      }
    });

  // ─── show ─────────────────────────────────────────────────────────────────────
  domainsCmd
    .command('show <domain-id>')
    .description('Show domain details and DNS records')
    .action(async (domainId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching domain...');

      let domain: Awaited<ReturnType<typeof client.getDomain>>;
      try {
        domain = await client.getDomain(domainId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Domain not found');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(domain)); return; }

      console.log('');
      console.log(`  ${chalk.bold(domain.domain)}  ${statusBadge(domain.status)}`);
      console.log(`  ${chalk.gray(domain.id)}`);
      console.log('');
      print.divider(52);
      console.log('');

      print.keyValue([
        { label: 'Domain',    value: chalk.cyan(domain.domain) },
        { label: 'Status',    value: statusBadge(domain.status) },
        { label: 'Verified',  value: domain.verified ? chalk.green('Yes ✓') : chalk.yellow('Not yet') },
        { label: 'Verified At', value: domain.verified_at ? print.relativeTime(domain.verified_at) : undefined },
        { label: 'Added',     value: print.relativeTime(domain.created_at) },
      ], { labelWidth: 12 });

      if (domain.nameservers?.length > 0) {
        console.log('');
        console.log('  ' + chalk.bold('Nameservers'));
        for (const ns of domain.nameservers) {
          console.log('  ' + chalk.cyan(ns));
        }
      }

      if (domain.dns_records?.length > 0) {
        console.log('');
        console.log('  ' + chalk.bold('DNS Records'));
        console.log('');
        console.log('  ' + chalk.gray('TYPE    NAME                           VALUE'));
        console.log('  ' + chalk.gray('─'.repeat(60)));
        for (const rec of domain.dns_records) {
          console.log(`  ${chalk.gray(rec.type.padEnd(8))}${chalk.white(rec.name.padEnd(31))} ${chalk.cyan(rec.value)}`);
        }
      }

      console.log('');
    });

  // ─── remove ───────────────────────────────────────────────────────────────────
  domainsCmd
    .command('remove <domain-id>')
    .alias('rm')
    .alias('delete')
    .description('Release a domain from your account')
    .option('--yes', 'Skip confirmation')
    .action(async (domainId: string, opts) => {
      const json = jsonMode();

      if (!opts.yes && !json) {
        const ok = await clack.confirm({
          message: chalk.red(`Release domain ${chalk.bold(domainId)}? DNS records will be deleted.`),
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }

      const client = await getClient();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Releasing domain ${chalk.cyan(domainId)}...`);

      try {
        await client.removeDomain(domainId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify({ success: true, domain_id: domainId }));
        } else {
          print.success(`Domain ${chalk.cyan(domainId)} released`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to release domain');
        process.exit(1);
      }
    });

  // ─── dns add ──────────────────────────────────────────────────────────────────
  domainsCmd
    .command('dns-add <domain-id>')
    .description('Add a DNS record to a domain')
    .option('--type <type>',  'Record type: A|CNAME|TXT|MX|NS')
    .option('--name <name>',  'Record name (@ for root)')
    .option('--value <value>', 'Record value')
    .option('--ttl <ttl>',    'TTL in seconds', '300')
    .action(async (domainId: string, opts) => {
      const client = await getClient();
      const json = jsonMode();

      if (!opts.type || !opts.name || !opts.value) {
        print.error('--type, --name, and --value are required');
        process.exit(1);
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Adding DNS record...');

      try {
        const result = await client.addDnsRecord(domainId, {
          type: opts.type as string,
          name: opts.name as string,
          value: opts.value as string,
          ttl: Number(opts.ttl),
        });
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success('DNS record added');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to add DNS record');
        process.exit(1);
      }
    });
}
