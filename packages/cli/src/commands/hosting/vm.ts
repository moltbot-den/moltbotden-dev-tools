/**
 * Hosting VM commands: list, create, show, start, stop, restart, delete, ssh, console
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { VM_TIER_SPECS, type VMTier } from '../../types/hosting.js';

export function addVMCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const vmCmd = parent
    .command('vm')
    .description('Manage compute virtual machines');

  // ─── list ─────────────────────────────────────────────────────────────────────
  vmCmd
    .command('list')
    .alias('ls')
    .description('List your virtual machines')
    .option('--status <status>', 'Filter by status (running, stopped, etc.)')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading VMs...');

      let result: Awaited<ReturnType<typeof client.listVMs>>;
      try {
        result = await client.listVMs(opts.status as string);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to list VMs');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(result)); return; }

      const { vms } = result;
      const running = vms.filter((v) => v.status === 'running').length;

      print.header(
        `Virtual Machines  ${chalk.gray(`(${vms.length} total · ${running} running)`)}`,
        'Compute instances powered by GCP'
      );
      console.log('');

      if (vms.length === 0) {
        print.empty('No VMs yet', 'Create one with:  mbd hosting vm create');
        return;
      }

      print.table(
        [
          { header: 'NAME',       key: 'name',       width: 20, format: (v) => chalk.cyan(String(v)) },
          { header: 'TIER',       key: 'tier',       width: 10, format: (v) => tierLabel(String(v) as VMTier) },
          { header: 'STATUS',     key: 'status',     width: 18, format: (v) => statusBadge(String(v)) },
          { header: 'IP',         key: 'ip_address', width: 16, format: (v) => v ? chalk.white(String(v)) : chalk.gray('–') },
          { header: 'ZONE',       key: 'gcp_zone',   width: 16, format: (v) => chalk.gray(String(v)) },
          { header: 'CREATED',    key: 'created_at',            format: (v) => chalk.gray(print.relativeTime(String(v))) },
        ],
        result.vms as Record<string, unknown>[]
      );

      console.log('');
      print.hint(`Show details:  mbd hosting vm show <name>`);
      print.hint(`SSH into a VM: mbd hosting vm ssh <name>`);
      console.log('');
    });

  // ─── create ───────────────────────────────────────────────────────────────────
  vmCmd
    .command('create')
    .description('Create a new virtual machine')
    .option('--name <name>',        'VM name')
    .option('--tier <tier>',        'Tier: nano|micro|standard|pro|power|ultra')
    .option('--ssh-key <key>',      'SSH public key (file path or raw key)')
    .option('--image <image>',      'OS image', 'ubuntu-22-04-x64')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();

      let name: string = opts.name as string;
      let tier: VMTier = opts.tier as VMTier;
      let sshKey: string = opts.sshKey as string;

      if (!json) {
        if (!name) {
          const n = await clack.text({
            message: 'VM name:',
            placeholder: 'my-agent-vm',
            validate: (v) => {
              if (!v || v.trim().length < 2) return 'Name must be at least 2 characters';
              if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(v)) return 'Use lowercase letters, numbers, and hyphens';
              if (v.length > 30) return 'Name must be at most 30 characters';
            },
          });
          if (clack.isCancel(n)) { clack.cancel('Cancelled'); process.exit(0); }
          name = (n as string).trim();
        }

        if (!tier) {
          const t = await clack.select({
            message: 'Select tier:',
            options: (Object.entries(VM_TIER_SPECS) as [VMTier, typeof VM_TIER_SPECS[VMTier]][]).map(([key, spec]) => ({
              value: key,
              label: `${spec.name.padEnd(9)}  ${String(spec.vcpus) + ' vCPU · ' + spec.ram_gb + ' GB RAM · ' + spec.ssd_gb + ' GB SSD'}`,
              hint: `$${(spec.price_cents / 100).toFixed(2)}/mo`,
            })),
          });
          if (clack.isCancel(t)) { clack.cancel('Cancelled'); process.exit(0); }
          tier = t as VMTier;
        }

        if (!sshKey) {
          const key = await clack.text({
            message: 'SSH public key (optional — paste content or press Enter to skip):',
            placeholder: 'ssh-rsa AAAA...',
          });
          if (clack.isCancel(key)) { clack.cancel('Cancelled'); process.exit(0); }
          sshKey = (key as string).trim();
        }

        // Confirmation
        const spec = VM_TIER_SPECS[tier];
        console.log('');
        const confirmed = await clack.confirm({
          message: `Create ${chalk.cyan(tier)} VM "${chalk.white(name)}" for ${chalk.yellow('$' + (spec.price_cents / 100).toFixed(2) + '/mo')}?`,
          initialValue: true,
        });
        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel('Cancelled');
          process.exit(0);
        }
      } else {
        // JSON mode — require all options
        if (!name || !tier) {
          print.error('--name and --tier are required in JSON mode');
          process.exit(1);
        }
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Provisioning VM (this takes ~60 seconds)...');

      try {
        const result = await client.createVM({
          name,
          tier,
          image: opts.image as string,
          ssh_public_key: sshKey || undefined,
        });

        if (spinner) spinner.stop('VM queued for provisioning ✓');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`VM "${chalk.cyan(name)}" is being provisioned`);
          console.log('');
          print.keyValue([
            { label: 'VM ID',   value: chalk.gray(result.id) },
            { label: 'Tier',    value: tierLabel(result.tier as VMTier) },
            { label: 'Status',  value: statusBadge(result.status) },
            { label: 'GCP Name', value: chalk.gray(result.gcp_instance_name) },
          ]);
          console.log('');
          print.info('VM will be ready in ~60 seconds');
          print.hint(`Watch status:  mbd hosting vm show ${result.id}`);
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Provisioning failed');
        handleVMError(err);
      }
    });

  // ─── show ─────────────────────────────────────────────────────────────────────
  vmCmd
    .command('show <vm-id>')
    .description('Show VM details')
    .action(async (vmId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching VM...');

      let vm: Awaited<ReturnType<typeof client.getVM>>;
      try {
        vm = await client.getVM(vmId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'VM not found');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(vm)); return; }

      const spec = VM_TIER_SPECS[vm.tier];

      console.log('');
      console.log(`  ${chalk.bold(vm.name)}  ${statusBadge(vm.status)}`);
      console.log(`  ${chalk.gray(vm.id)}`);
      console.log('');
      print.divider(52);
      console.log('');

      print.keyValue([
        { label: 'Name',         value: vm.name },
        { label: 'Status',       value: statusBadge(vm.status) },
        { label: 'Tier',         value: `${tierLabel(vm.tier)}` },
        { label: 'Machine Type', value: spec?.machine_type ?? '–' },
        { label: 'vCPUs',        value: spec ? `${spec.vcpus} vCPU` : '–' },
        { label: 'Memory',       value: spec ? `${spec.ram_gb} GB RAM` : '–' },
        { label: 'SSD',          value: spec ? `${spec.ssd_gb} GB` : '–' },
        { label: 'Transfer',     value: spec ? `${spec.transfer_tb} TB/mo` : '–' },
        { label: 'Public IP',    value: vm.ip_address ? chalk.white(vm.ip_address) : chalk.gray('Not assigned yet') },
        { label: 'Internal IP',  value: vm.internal_ip ? chalk.gray(vm.internal_ip) : undefined },
        { label: 'Zone',         value: chalk.gray(vm.gcp_zone) },
        { label: 'GCP Name',     value: chalk.gray(vm.gcp_instance_name) },
        { label: 'Image',        value: chalk.gray(vm.image) },
        { label: 'Created',      value: print.relativeTime(vm.created_at) },
        { label: 'Started',      value: vm.started_at ? print.relativeTime(vm.started_at) : undefined },
        { label: 'Price',        value: spec ? chalk.yellow(`$${(spec.price_cents / 100).toFixed(2)}/mo`) : '–' },
        { label: 'Error',        value: vm.error_message ? chalk.red(vm.error_message) : undefined },
      ], { labelWidth: 14 });

      console.log('');

      if (vm.ip_address && vm.status === 'running') {
        print.hint(`SSH:  ssh root@${vm.ip_address}`);
      }
      if (vm.status === 'running') {
        print.hint(`Stop VM:  mbd hosting vm stop ${vm.id}`);
      }
      if (vm.status === 'stopped') {
        print.hint(`Start VM:  mbd hosting vm start ${vm.id}`);
      }
      console.log('');
    });

  // ─── start ────────────────────────────────────────────────────────────────────
  vmCmd
    .command('start <vm-id>')
    .description('Start a stopped VM')
    .action(async (vmId: string) => {
      await vmAction(client => client.startVM(vmId), getClient, jsonMode,
        `Starting VM ${chalk.cyan(vmId)}...`, `VM ${chalk.cyan(vmId)} started`);
    });

  // ─── stop ─────────────────────────────────────────────────────────────────────
  vmCmd
    .command('stop <vm-id>')
    .description('Stop a running VM')
    .option('--yes', 'Skip confirmation')
    .action(async (vmId: string, opts) => {
      if (!opts.yes && !jsonMode()) {
        const ok = await clack.confirm({
          message: `Stop VM ${chalk.cyan(vmId)}? Billing continues while stopped.`,
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }
      await vmAction(client => client.stopVM(vmId), getClient, jsonMode,
        `Stopping VM ${chalk.cyan(vmId)}...`, `VM ${chalk.cyan(vmId)} stopped`);
    });

  // ─── restart ──────────────────────────────────────────────────────────────────
  vmCmd
    .command('restart <vm-id>')
    .description('Restart a VM')
    .action(async (vmId: string) => {
      await vmAction(client => client.restartVM(vmId), getClient, jsonMode,
        `Restarting VM ${chalk.cyan(vmId)}...`, `VM ${chalk.cyan(vmId)} restarted`);
    });

  // ─── delete ───────────────────────────────────────────────────────────────────
  vmCmd
    .command('delete <vm-id>')
    .alias('rm')
    .description('Delete a VM permanently')
    .option('--yes', 'Skip confirmation')
    .action(async (vmId: string, opts) => {
      const json = jsonMode();

      if (!opts.yes && !json) {
        const ok = await clack.confirm({
          message: chalk.red(`Permanently delete VM ${chalk.bold(vmId)}? This cannot be undone.`),
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }

      const client = await getClient();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Deleting VM ${chalk.cyan(vmId)}...`);

      try {
        await client.deleteVM(vmId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify({ success: true, vm_id: vmId }));
        } else {
          print.success(`VM ${chalk.cyan(vmId)} deleted`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Delete failed');
        process.exit(1);
      }
    });

  // ─── ssh ──────────────────────────────────────────────────────────────────────
  vmCmd
    .command('ssh <vm-id>')
    .description('Show SSH command for a VM')
    .option('--user <user>', 'SSH user', 'root')
    .action(async (vmId: string, opts) => {
      const client = await getClient();
      const spinner = clack.spinner();
      spinner.start('Fetching VM details...');

      let vm: Awaited<ReturnType<typeof client.getVM>>;
      try {
        vm = await client.getVM(vmId);
        spinner.stop('');
      } catch (err) {
        spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'VM not found');
        process.exit(1);
      }

      if (vm.status !== 'running') {
        print.warn(`VM is ${vm.status}, not running. Start it first.`);
        print.hint(`mbd hosting vm start ${vmId}`);
        process.exit(1);
      }

      if (!vm.ip_address) {
        print.warn('VM has no public IP address yet. Wait a moment and try again.');
        process.exit(1);
      }

      const cmd = `ssh ${opts.user}@${vm.ip_address}`;
      console.log('');
      console.log(`  ${chalk.cyan(cmd)}`);
      console.log('');
      print.hint('Copy the command above and run it in your terminal');
    });

  // ─── console ──────────────────────────────────────────────────────────────────
  vmCmd
    .command('console <vm-id>')
    .description('Show recent console output from a VM')
    .option('--lines <n>', 'Number of lines', '50')
    .action(async (vmId: string, opts) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching console output...');

      try {
        const result = await client.getVMConsole(vmId, Number(opts.lines));
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.header(`Console: ${vmId}`);
          print.divider(52);
          console.log(chalk.gray(result.output || '(no output)'));
          print.divider(52);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to get console output');
        process.exit(1);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierLabel(tier: VMTier): string {
  const spec = VM_TIER_SPECS[tier];
  if (!spec) return tier;
  return `${chalk.white(spec.name)} ${chalk.gray(`(${spec.vcpus}vCPU/${spec.ram_gb}GB)`)}`;
}

async function vmAction(
  action: (client: MoltbotDenClient) => Promise<{ status: string }>,
  getClient: () => Promise<MoltbotDenClient>,
  jsonMode: () => boolean,
  startMsg: string,
  successMsg: string
): Promise<void> {
  const client = await getClient();
  const json = jsonMode();
  const spinner = json ? null : clack.spinner();
  if (spinner) spinner.start(startMsg);

  try {
    const result = await action(client);
    if (spinner) spinner.stop('');

    if (json) {
      console.log(JSON.stringify(result));
    } else {
      print.success(successMsg);
    }
  } catch (err) {
    if (spinner) spinner.stop('Failed');
    print.error(err instanceof Error ? err.message : 'Operation failed');
    process.exit(1);
  }
}

function handleVMError(err: unknown): never {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('Insufficient balance')) {
      print.error('Insufficient hosting balance');
      print.hint('Top up your balance:  mbd hosting billing topup');
    } else if (msg.includes('limit')) {
      print.error('VM limit reached for your tier');
      print.hint('Contact support to increase your limit');
    } else {
      print.error(msg);
    }
  } else {
    print.error('VM creation failed');
  }
  process.exit(1);
}
