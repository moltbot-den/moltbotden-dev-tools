/**
 * mbd hosting domains: subdomains of moltbotden.com, custom domains and DNS records.
 * API: /v1/hosting/domains (routers/hosting/domains.py, models/hosting/domain.py).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { UsageError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompts.js';
import { DNS_RECORD_TYPES, DNS_TTL, type DnsRecord, type Domain, type DomainType } from '../../types/hosting.js';
import {
  cancelled, examples, hostingAction, moreHint, parseIntOption, relTime, validateChoice, withSpinner,
} from './shared.js';

const DOMAIN_TYPES: readonly DomainType[] = ['subdomain', 'custom'];
const HOSTNAME_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function defaultDomainType(hostname: string): DomainType {
  return hostname.endsWith('.moltbotden.com') ? 'subdomain' : 'custom';
}

function printRecords(records: DnsRecord[]): void {
  print.table(
    [
      { header: 'ID',      key: 'id', format: (v) => (v ? chalk.gray(String(v)) : chalk.gray('–')) },
      { header: 'TYPE',    key: 'record_type' },
      { header: 'NAME',    key: 'name', format: (v) => chalk.cyan(String(v)) },
      { header: 'VALUE',   key: 'value' },
      { header: 'TTL',     key: 'ttl', align: 'right' },
      { header: 'PROXIED', key: 'proxied', format: (v) => (v ? 'yes' : 'no') },
    ],
    records,
  );
}

export function addDomainCommands(parent: Command, program: Command): void {
  const domCmd = parent.command('domains').alias('domain').description('Manage domains and DNS records');
  examples(domCmd, ['mbd hosting domains add my-agent.moltbotden.com', 'mbd hosting domains dns list <domain-id>']);

  // ─── list ──────────────────────────────────────────────────────────────────
  examples(
    domCmd
      .command('list')
      .alias('ls')
      .description('List your domains')
      .option('--limit <n>', 'Maximum domains to return (1-100)', '50'),
    ['mbd hosting domains list'],
  ).action(hostingAction(program, 'domains', async (h, opts: { limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const result = await withSpinner('Loading domains', () => h.api.listDomains({ limit }));
    if (h.json) return print.json(result);
    print.header(`Domains  ${chalk.gray(`(${result.domains.length})`)}`);
    console.log('');
    if (result.domains.length === 0) {
      print.empty('No domains yet', 'Add one:  mbd hosting domains add my-agent.moltbotden.com');
      return;
    }
    print.table(
      [
        { header: 'ID',       key: 'id',          format: (v) => chalk.gray(String(v)) },
        { header: 'HOSTNAME', key: 'hostname',    format: (v) => chalk.cyan(String(v)) },
        { header: 'TYPE',     key: 'domain_type' },
        { header: 'SSL',      key: 'ssl_status',  format: (v) => statusBadge(String(v ?? 'pending')) },
        { header: 'RECORDS',  key: 'dns_records', align: 'right', format: (v) => String(Array.isArray(v) ? v.length : 0) },
        { header: 'CREATED',  key: 'created_at',  format: (v) => chalk.gray(relTime(v)) },
      ],
      result.domains,
    );
    console.log('');
    moreHint(result.count, limit, 'mbd hosting domains list');
    print.hint('Details and records:  mbd hosting domains show <id>');
  }));

  // ─── add ───────────────────────────────────────────────────────────────────
  examples(
    domCmd
      .command('add <hostname>')
      .description('Register a moltbotden.com subdomain or a custom domain')
      .option('--type <type>', 'subdomain|custom (default: subdomain for *.moltbotden.com, else custom)')
      .option('--vm <vm-id>', 'Point the domain at this VM'),
    ['mbd hosting domains add my-agent.moltbotden.com --vm <vm-id>', 'mbd hosting domains add agent.example.com --type custom'],
  ).action(hostingAction(program, 'domains', async (h, rawHostname: string, opts: { type?: string; vm?: string }) => {
    const hostname = rawHostname.trim().toLowerCase().replace(/\.$/, '');
    if (!HOSTNAME_RE.test(hostname)) throw new UsageError(`"${rawHostname}" is not a valid hostname.`);
    const domainType = opts.type !== undefined ? validateChoice(opts.type, DOMAIN_TYPES, '--type') : defaultDomainType(hostname);
    const result = await withSpinner('Registering domain', () =>
      h.api.addDomain({ hostname, domain_type: domainType, target_vm_id: opts.vm }));
    if (h.json) return print.json(result);
    print.success(`Registered ${chalk.cyan(result.hostname)} (${result.id}); SSL is ${result.ssl_status}`);
    print.hint(`Add records:  mbd hosting domains dns add ${result.id} --type A --name ${hostname} --value <ip>`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    domCmd.command('show <domain-id>').alias('get').description('Show a domain and its DNS records'),
    ['mbd hosting domains show <domain-id>'],
  ).action(hostingAction(program, 'domains', async (h, domainId: string) => {
    const d: Domain = await withSpinner('Fetching domain', () => h.api.getDomain(domainId));
    if (h.json) return print.json(d);
    console.log('');
    console.log(`  ${chalk.bold(d.hostname)}  ${statusBadge(d.ssl_status ?? 'pending')}`);
    console.log(`  ${chalk.gray(d.id)}`);
    console.log('');
    print.keyValue([
      { label: 'Type',      value: d.domain_type },
      { label: 'SSL',       value: d.ssl_status },
      { label: 'Target IP', value: d.target_ip ?? undefined },
      { label: 'Target VM', value: d.target_vm_id ?? undefined },
      { label: 'Created',   value: relTime(d.created_at) },
    ], { labelWidth: 9 });
    console.log('');
    const records = d.dns_records ?? [];
    if (records.length === 0) {
      print.empty('No DNS records', `Add one:  mbd hosting domains dns add ${d.id} --type A --name ${d.hostname} --value <ip>`);
      return;
    }
    printRecords(records);
    console.log('');
    print.hint(`Remove a record:  mbd hosting domains dns remove ${d.id} <record-id>`);
  }));

  // ─── remove ────────────────────────────────────────────────────────────────
  examples(
    domCmd
      .command('remove <domain-id>')
      .alias('rm')
      .alias('delete')
      .description('Release a domain and delete its DNS records')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting domains remove <domain-id>', 'mbd --json hosting domains remove <domain-id> --yes'],
  ).action(hostingAction(program, 'domains', async (h, domainId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Release domain ${domainId} and delete all of its DNS records?` });
    if (!ok) cancelled();
    const result = await withSpinner('Releasing domain', () => h.api.removeDomain(domainId));
    if (h.json) return print.json(result);
    print.success(`Domain ${chalk.cyan(domainId)} released`);
  }));

  // ─── dns ───────────────────────────────────────────────────────────────────
  const dns = domCmd.command('dns').description('Manage DNS records of a domain');
  examples(dns, ['mbd hosting domains dns list <domain-id>', 'mbd hosting domains dns add <domain-id> --type A --name <hostname> --value <ip>']);

  examples(
    dns.command('list <domain-id>').alias('ls').description('List DNS records'),
    ['mbd hosting domains dns list <domain-id>'],
  ).action(hostingAction(program, 'domains', async (h, domainId: string) => {
    const d = await withSpinner('Fetching records', () => h.api.getDomain(domainId));
    const records = d.dns_records ?? [];
    if (h.json) return print.json({ domain_id: d.id, hostname: d.hostname, records });
    if (records.length === 0) {
      print.empty(`No DNS records on ${d.hostname}`, `Add one:  mbd hosting domains dns add ${d.id} --type A --name ${d.hostname} --value <ip>`);
      return;
    }
    printRecords(records);
  }));

  const addDns = dns
    .command('add <domain-id>')
    .description('Add a DNS record')
    .requiredOption('--type <type>', `Record type: ${DNS_RECORD_TYPES.join('|')}`)
    .requiredOption('--name <name>', 'Record name, within the domain (e.g. www.my-agent.moltbotden.com)')
    .requiredOption('--value <value>', 'Record value (IP, hostname or text)')
    .option('--ttl <seconds>', `TTL in seconds (${DNS_TTL.min}-${DNS_TTL.max})`, String(DNS_TTL.default))
    .option('--proxied', 'Proxy through Cloudflare (A/AAAA/CNAME only)');
  examples(addDns, [
    'mbd hosting domains dns add <domain-id> --type A --name my-agent.moltbotden.com --value 203.0.113.10',
    'mbd hosting domains dns add <domain-id> --type TXT --name my-agent.moltbotden.com --value "v=spf1 -all" --ttl 300',
  ]).action(hostingAction(program, 'domains', async (h, domainId: string, opts: {
    type: string; name: string; value: string; ttl: string; proxied?: boolean;
  }) => {
    const recordType = validateChoice(opts.type.toUpperCase(), DNS_RECORD_TYPES, '--type');
    const ttl = parseIntOption(opts.ttl, '--ttl', DNS_TTL.min, DNS_TTL.max);
    if (opts.proxied && !['A', 'AAAA', 'CNAME'].includes(recordType)) {
      throw new UsageError('--proxied only applies to A, AAAA and CNAME records.');
    }
    const record = await withSpinner('Adding record', () => h.api.addDnsRecord(domainId, {
      record_type: recordType,
      name: opts.name,
      value: opts.value,
      ttl,
      proxied: Boolean(opts.proxied),
    }));
    if (h.json) return print.json(record);
    print.success(`Added ${record.record_type} ${chalk.cyan(record.name)} → ${record.value}${record.id ? ` (${record.id})` : ''}`);
  }));

  examples(
    dns
      .command('remove <domain-id> <record-id>')
      .alias('rm')
      .description('Delete a DNS record')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting domains dns remove <domain-id> <record-id>'],
  ).action(hostingAction(program, 'domains', async (h, domainId: string, recordId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Delete DNS record ${recordId} from domain ${domainId}?` });
    if (!ok) cancelled();
    const result = await withSpinner('Removing record', () => h.api.removeDnsRecord(domainId, recordId));
    if (h.json) return print.json(result);
    print.success(`DNS record ${chalk.cyan(recordId)} removed`);
  }));
}
