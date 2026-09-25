/**
 * mbd hosting vm: compute VMs, their SSH keys, volumes and firewall rules.
 * API: /v1/hosting/compute/vms (routers/hosting/compute.py) and
 * /v1/hosting/networking/firewalls (routers/hosting/networking.py).
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { CliError, reportError, UsageError } from '../../lib/errors.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../../lib/prompts.js';
import {
  DEFAULT_VM_IMAGE, DISK_TYPES, VM_IMAGES, VM_SSH_USER, VM_TIER_SPECS, VOLUME_SIZE_GB,
  type DiskType, type FirewallRule, type VM, type VMTier,
} from '../../types/hosting.js';
import {
  cancelled, collect, examples, hostingAction, money, moreHint, nameProblem, parseIntOption, parseTimeout,
  readSshKey, relTime, validateChoice, validateName, waitWithSpinner, withSpinner, withWaitOptions,
  type Hosting,
} from './shared.js';

const TIERS = Object.keys(VM_TIER_SPECS) as VMTier[];

function tierLabel(tier: string): string {
  const spec = VM_TIER_SPECS[tier as VMTier];
  if (!spec) return tier;
  return `${chalk.white(spec.name)} ${chalk.gray(`(${spec.vcpus} vCPU / ${spec.ram_gb} GB)`)}`;
}

function waitForVm(h: Hosting, vmId: string, done: string[], label: string, timeoutSec: number): Promise<VM> {
  return waitWithSpinner({
    fetch: () => h.api.getVM(vmId),
    done,
    label,
    timeoutSec,
    showCommand: `mbd hosting vm show ${vmId}`,
  });
}

export function addVMCommands(parent: Command, program: Command): void {
  const vmCmd = parent.command('vm').description('Manage compute virtual machines');
  examples(vmCmd, ['mbd hosting vm list', 'mbd hosting vm create --name web --tier micro --wait', 'mbd hosting vm ssh <vm-id>']);

  // ─── list ──────────────────────────────────────────────────────────────────
  examples(
    vmCmd
      .command('list')
      .alias('ls')
      .description('List your virtual machines')
      .option('--status <status>', 'Only VMs in this status (running, stopped, error, ...)')
      .option('--limit <n>', 'Maximum VMs to return (1-100)', '50'),
    ['mbd hosting vm list', 'mbd hosting vm list --status running', 'mbd --json hosting vm list | jq ".vms[].id"'],
  ).action(hostingAction(program, 'compute', async (h, opts: { status?: string; limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const result = await withSpinner('Loading VMs', () => h.api.listVMs({ status: opts.status, limit }));
    if (h.json) return print.json(result);

    const running = result.vms.filter((v) => v.status === 'running').length;
    print.header(`Virtual Machines  ${chalk.gray(`(${result.vms.length} · ${running} running)`)}`);
    console.log('');
    if (result.vms.length === 0) {
      print.empty(opts.status ? `No VMs with status "${opts.status}"` : 'No VMs yet', 'Create one:  mbd hosting vm create');
      return;
    }
    print.table(
      [
        { header: 'ID',      key: 'id',         format: (v) => chalk.gray(String(v)) },
        { header: 'NAME',    key: 'name',       format: (v) => chalk.cyan(String(v)) },
        { header: 'TIER',    key: 'tier',       format: (v) => tierLabel(String(v)) },
        { header: 'STATUS',  key: 'status',     format: (v) => statusBadge(String(v)) },
        { header: 'IP',      key: 'ip_address', format: (v) => (v ? String(v) : chalk.gray('–')) },
        { header: 'CREATED', key: 'created_at', format: (v) => chalk.gray(relTime(v)) },
      ],
      result.vms,
    );
    console.log('');
    moreHint(result.count, limit, 'mbd hosting vm list');
    print.hint('Details:  mbd hosting vm show <id>');
  }));

  // ─── create ────────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      vmCmd
        .command('create')
        .description('Create a virtual machine (charges the first month to your hosting balance)')
        .option('--name <name>', 'VM name: lowercase letters, digits, hyphens; starts with a letter; max 50')
        .option('--tier <tier>', `Tier: ${TIERS.join('|')}`)
        .option('--image <image>', `Boot image: ${VM_IMAGES.join('|')}`, DEFAULT_VM_IMAGE)
        .option('--ssh-key <key-or-file>', `SSH public key, or a path to one (installed for user "${VM_SSH_USER}")`)
        .option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    [
      'mbd hosting vm create',
      'mbd hosting vm create --name web-1 --tier micro --ssh-key ~/.ssh/id_ed25519.pub --wait',
      'mbd --json hosting vm create --name worker --tier nano',
    ],
  ).action(hostingAction(program, 'compute', async (h, opts: {
    name?: string; tier?: string; image: string; sshKey?: string; yes?: boolean; wait?: boolean; timeout?: string;
  }) => {
    const image = validateChoice(opts.image, VM_IMAGES, '--image');
    let name = opts.name !== undefined ? validateName(opts.name) : undefined;
    let tier = opts.tier !== undefined ? validateChoice(opts.tier, TIERS, '--tier') : undefined;
    let sshKey = opts.sshKey !== undefined ? readSshKey(opts.sshKey) : undefined;
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;

    if (!name) {
      requireInteractive('--name', 'VM name');
      const n = await clack.text({ message: 'VM name', placeholder: 'my-agent-vm', validate: (v) => nameProblem((v ?? '').trim()) });
      if (clack.isCancel(n)) cancelled();
      name = n.trim();
    }
    if (!tier) {
      requireInteractive('--tier', `one of ${TIERS.join(', ')}`);
      const t = await clack.select({
        message: 'Tier',
        options: TIERS.map((key) => {
          const s = VM_TIER_SPECS[key];
          return { value: key, label: `${s.name.padEnd(9)} ${s.vcpus} vCPU · ${s.ram_gb} GB RAM · ${s.ssd_gb} GB SSD` };
        }),
      });
      if (clack.isCancel(t)) cancelled();
      tier = t;
    }
    if (sshKey === undefined && isInteractive()) {
      const k = await clack.text({
        message: `SSH public key or path to one (optional, for user "${VM_SSH_USER}")`,
        placeholder: '~/.ssh/id_ed25519.pub',
        validate: (v) => {
          if (!v?.trim()) return undefined;
          try { readSshKey(v); return undefined; } catch (e) { return (e as Error).message; }
        },
      });
      if (clack.isCancel(k)) cancelled();
      sshKey = k.trim() ? readSshKey(k) : undefined;
    }

    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Create ${tier} VM "${name}"? The first month is charged to your hosting balance now` +
          (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }

    const created = await withSpinner('Creating VM', () => h.api.createVM({ name: name!, tier: tier!, image, ssh_public_key: sshKey }));
    if (timeoutSec !== undefined) {
      const vm = await waitForVm(h, created.id, ['running'], `VM ${created.name}`, timeoutSec);
      if (h.json) return print.json(vm);
      print.success(`VM "${chalk.cyan(vm.name)}" is running`);
      if (vm.ip_address) print.hint(`SSH:  ssh ${VM_SSH_USER}@${vm.ip_address}`);
      return;
    }
    if (h.json) return print.json(created);
    print.success(`VM "${chalk.cyan(created.name)}" queued for provisioning (${created.id})`);
    print.hint(`Watch it:  mbd hosting vm show ${created.id}   (pass --wait next time to block until it is running)`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    vmCmd.command('show <vm-id>').alias('get').description('Show VM details'),
    ['mbd hosting vm show <vm-id>', 'mbd --json hosting vm show <vm-id> | jq -r .ip_address'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string) => {
    const vm = await withSpinner('Fetching VM', () => h.api.getVM(vmId));
    if (h.json) return print.json(vm);
    const spec = VM_TIER_SPECS[vm.tier];
    console.log('');
    console.log(`  ${chalk.bold(vm.name)}  ${statusBadge(vm.status)}`);
    console.log(`  ${chalk.gray(vm.id)}`);
    console.log('');
    print.keyValue([
      { label: 'Tier',        value: tierLabel(vm.tier) },
      { label: 'Resources',   value: spec ? `${spec.vcpus} vCPU · ${spec.ram_gb} GB RAM · ${spec.ssd_gb} GB SSD · ${spec.transfer_tb} TB transfer` : undefined },
      { label: 'Public IP',   value: vm.ip_address ?? chalk.gray('not assigned yet') },
      { label: 'Internal IP', value: vm.internal_ip ?? undefined },
      { label: 'Zone',        value: vm.gcp_zone },
      { label: 'Image',       value: vm.image },
      { label: 'Created',     value: relTime(vm.created_at) },
      { label: 'Started',     value: vm.started_at ? relTime(vm.started_at) : undefined },
      { label: 'Error',       value: vm.error_message ? chalk.red(vm.error_message) : undefined },
    ], { labelWidth: 12 });
    console.log('');
    if (vm.status === 'running' && vm.ip_address) print.hint(`SSH:    ssh ${VM_SSH_USER}@${vm.ip_address}`);
    if (vm.status === 'running') print.hint(`Stop:   mbd hosting vm stop ${vm.id}`);
    if (vm.status === 'stopped') print.hint(`Start:  mbd hosting vm start ${vm.id}`);
  }));

  // ─── start / stop / restart ────────────────────────────────────────────────
  const lifecycle = [
    { name: 'start',   desc: 'Start a stopped VM',  call: 'startVM',   target: 'running', verb: 'Start' },
    { name: 'stop',    desc: 'Stop a running VM',   call: 'stopVM',    target: 'stopped', verb: 'Stop' },
    { name: 'restart', desc: 'Restart a running VM', call: 'restartVM', target: 'running', verb: 'Restart' },
  ] as const;
  for (const op of lifecycle) {
    const cmd = withWaitOptions(vmCmd.command(`${op.name} <vm-id>`).description(op.desc));
    if (op.name === 'stop') cmd.option('-y, --yes', 'Skip the confirmation prompt');
    examples(cmd, [`mbd hosting vm ${op.name} <vm-id>`, `mbd hosting vm ${op.name} <vm-id> --wait --timeout 300`])
      .action(hostingAction(program, 'compute', async (h, vmId: string, opts: { yes?: boolean; wait?: boolean; timeout?: string }) => {
        const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;
        if (op.name === 'stop') {
          const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Stop VM ${vmId}? Anything running on it goes offline.` });
          if (!ok) cancelled();
        }
        const result = await withSpinner(`${op.verb} VM`, () => h.api[op.call](vmId));
        if (timeoutSec !== undefined) {
          const vm = await waitForVm(h, vmId, [op.target], `VM ${vmId}`, timeoutSec);
          if (h.json) return print.json(vm);
          print.success(`VM ${chalk.cyan(vmId)} is ${vm.status}`);
          return;
        }
        if (h.json) return print.json(result);
        print.success(`${op.verb} requested for VM ${chalk.cyan(vmId)} (${result.status})`);
        print.hint(`Check progress:  mbd hosting vm show ${vmId}`);
      }));
  }

  // ─── resize ────────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      vmCmd
        .command('resize <vm-id>')
        .description('Move a VM to another tier (it is stopped, resized and started again, even if it was stopped; upgrades charge the monthly difference)')
        .requiredOption('--tier <tier>', `New tier: ${TIERS.join('|')} (the disk cannot shrink)`)
        .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ),
    ['mbd hosting vm resize <vm-id> --tier standard --wait', 'mbd --json hosting vm resize <vm-id> --tier pro --yes'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { tier: string; yes?: boolean; wait?: boolean; timeout?: string }) => {
    const tier = validateChoice(opts.tier, TIERS, '--tier');
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;
    const ok = await confirmDestructive({
      yes: opts.yes, json: h.json,
      message: `Resize VM ${vmId} to ${tier}? It goes offline while it is resized and comes back running; an upgrade charges the monthly price difference now.`,
    });
    if (!ok) cancelled();
    const result = await withSpinner('Resizing VM', () => h.api.resizeVM(vmId, tier));
    if (timeoutSec !== undefined) {
      const vm = await waitForVm(h, vmId, ['running'], `VM ${vmId}`, timeoutSec);
      if (h.json) return print.json(vm);
      print.success(`VM ${chalk.cyan(vmId)} is now ${tierLabel(vm.tier)} (${vm.status})`);
      return;
    }
    if (h.json) return print.json(result);
    print.success(`Resize of VM ${chalk.cyan(vmId)} from ${result.from_tier} to ${result.to_tier} started`);
    print.hint(`Check progress:  mbd hosting vm show ${vmId}`);
  }));

  // ─── rebuild ───────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      vmCmd
        .command('rebuild <vm-id>')
        .description('Reinstall the boot disk from a fresh image (keeps the IP and attached volumes)')
        .option('--image <image>', `Boot image: ${VM_IMAGES.join('|')}`, DEFAULT_VM_IMAGE)
        .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ),
    ['mbd hosting vm rebuild <vm-id>', 'mbd hosting vm rebuild <vm-id> --image ubuntu-2404-lts-amd64 --yes --wait'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { image: string; yes?: boolean; wait?: boolean; timeout?: string }) => {
    const image = validateChoice(opts.image, VM_IMAGES, '--image');
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;
    const ok = await confirmDestructive({
      yes: opts.yes, json: h.json,
      message: `Rebuild VM ${vmId} from ${image}? Everything on its boot disk is erased (attached volumes are kept).`,
    });
    if (!ok) cancelled();
    const result = await withSpinner('Rebuilding VM', () => h.api.rebuildVM(vmId, image));
    if (timeoutSec !== undefined) {
      const vm = await waitForVm(h, vmId, ['running'], `VM ${vmId}`, timeoutSec);
      if (h.json) return print.json(vm);
      print.success(`VM ${chalk.cyan(vmId)} rebuilt from ${vm.image}`);
      return;
    }
    if (h.json) return print.json(result);
    print.success(`Rebuild of VM ${chalk.cyan(vmId)} from ${result.image} started`);
    print.hint(`Check progress:  mbd hosting vm show ${vmId}`);
  }));

  // ─── delete ────────────────────────────────────────────────────────────────
  examples(
    vmCmd
      .command('delete <vm-id>')
      .alias('rm')
      .description('Delete a VM and its boot disk permanently')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting vm delete <vm-id>', 'mbd --json hosting vm delete <vm-id> --yes'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Permanently delete VM ${vmId} and its disk? This cannot be undone.` });
    if (!ok) cancelled();
    const result = await withSpinner('Deleting VM', () => h.api.deleteVM(vmId));
    if (h.json) return print.json(result);
    print.success(`Deletion of VM ${chalk.cyan(vmId)} started`);
    print.hint('It disappears from `mbd hosting vm list` once the server finishes.');
  }));

  // ─── ssh ───────────────────────────────────────────────────────────────────
  examples(
    vmCmd
      .command('ssh <vm-id>')
      .description('Print the SSH command for a running VM')
      .option('--user <user>', 'SSH user', VM_SSH_USER),
    ['mbd hosting vm ssh <vm-id>', '$(mbd hosting vm ssh <vm-id> --json | jq -r .command)'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { user: string }) => {
    const vm = await withSpinner('Fetching VM', () => h.api.getVM(vmId));
    if (vm.status !== 'running') {
      throw new CliError(`VM ${vmId} is ${vm.status}, not running.`, { details: { vm_id: vmId, status: vm.status }, hint: `mbd hosting vm start ${vmId} --wait` });
    }
    if (!vm.ip_address) throw new CliError('The VM has no public IP yet. Try again in a moment.', { details: { vm_id: vmId } });
    const command = `ssh ${opts.user}@${vm.ip_address}`;
    if (h.json) return print.json({ vm_id: vm.id, user: opts.user, host: vm.ip_address, command });
    console.log(`\n  ${chalk.cyan(command)}\n`);
    print.hint(`Keys are installed for "${VM_SSH_USER}". Replace them with: mbd hosting vm ssh-keys ${vm.id} --key <file>`);
  }));

  // ─── console / logs ────────────────────────────────────────────────────────
  examples(
    vmCmd
      .command('console <vm-id>')
      .description('Show the tail of the VM serial console')
      .option('--lines <n>', 'Lines to show from the end (1-10000)', '50'),
    ['mbd hosting vm console <vm-id>', 'mbd hosting vm console <vm-id> --lines 200'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { lines: string }) => {
    const lines = parseIntOption(opts.lines, '--lines', 1, 10_000);
    const result = await withSpinner('Fetching console output', () => h.api.getVMConsole(vmId));
    const output = tail(result.output ?? '', lines);
    if (h.json) return print.json({ vm_id: vmId, output });
    if (!output.trim()) return print.empty('No console output yet');
    printLogLines(output);
  }));

  examples(
    vmCmd
      .command('logs <vm-id>')
      .description('Show VM console logs, optionally following new output')
      .option('--lines <n>', 'Initial lines to show from the end (1-10000)', '50')
      .option('-f, --follow', 'Keep polling for new output')
      .option('--interval <ms>', 'Poll interval with --follow (1000-60000)', '3000'),
    ['mbd hosting vm logs <vm-id> --follow', 'mbd --json hosting vm logs <vm-id> --follow   # one JSON object per new chunk'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { lines: string; follow?: boolean; interval: string }) => {
    const lines = parseIntOption(opts.lines, '--lines', 1, 10_000);
    const interval = parseIntOption(opts.interval, '--interval', 1000, 60_000);
    const emit = (chunk: string): void => {
      if (!chunk) return;
      if (h.json) console.log(JSON.stringify({ vm_id: vmId, output: chunk, timestamp: new Date().toISOString() }));
      else printLogLines(chunk);
    };

    // The first fetch fails the command (mapped exit code); later polls only report.
    let last = (await h.api.getVMConsole(vmId)).output ?? '';
    if (!h.json && !last.trim()) print.empty('No console output yet');
    emit(tail(last, lines));
    if (!opts.follow) return;

    if (!h.json) print.hint('Following (Ctrl+C to stop)...');
    for (;;) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const current = (await h.api.getVMConsole(vmId)).output ?? '';
        emit(newContent(last, current));
        last = current;
      } catch (err) {
        reportError(err, 'Failed to fetch logs');
      }
    }
  }));

  // ─── ssh-keys ──────────────────────────────────────────────────────────────
  examples(
    vmCmd
      .command('ssh-keys <vm-id>')
      .description(`Replace every SSH key on a running VM (user "${VM_SSH_USER}")`)
      .option('--key <key-or-file>', 'Public key or path to one; repeat for several (max 20)', collect, [])
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting vm ssh-keys <vm-id> --key ~/.ssh/id_ed25519.pub', 'mbd hosting vm ssh-keys <vm-id> --key a.pub --key b.pub --yes'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { key: string[]; yes?: boolean }) => {
    if (opts.key.length === 0) throw new UsageError('Pass at least one --key <key-or-file>.');
    if (opts.key.length > 20) throw new UsageError('At most 20 --key values are allowed.');
    const keys = opts.key.map((k) => readSshKey(k, '--key'));
    const ok = await confirmDestructive({
      yes: opts.yes, json: h.json,
      message: `Replace all SSH keys on VM ${vmId} with ${keys.length} key(s)? Keys not listed stop working.`,
    });
    if (!ok) cancelled();
    const result = await withSpinner('Updating SSH keys', () => h.api.setVMSshKeys(vmId, keys));
    if (h.json) return print.json(result);
    print.success(`VM ${chalk.cyan(vmId)} now accepts ${result.key_count} key(s)`);
    print.hint(`Connect:  mbd hosting vm ssh ${vmId}`);
  }));

  addVolumeCommands(vmCmd, program);
  addFirewallCommands(vmCmd, program);
}

// ─── volumes ─────────────────────────────────────────────────────────────────

function addVolumeCommands(vmCmd: Command, program: Command): void {
  const vol = vmCmd.command('volumes').alias('volume').description('Manage extra persistent disks attached to a VM');
  examples(vol, ['mbd hosting vm volumes list <vm-id>', 'mbd hosting vm volumes attach <vm-id> --size 100']);

  examples(
    vol.command('list <vm-id>').alias('ls').description('List disks attached to a VM'),
    ['mbd hosting vm volumes list <vm-id>'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string) => {
    const result = await withSpinner('Loading volumes', () => h.api.listVolumes(vmId));
    if (h.json) return print.json(result);
    if (result.volumes.length === 0) {
      print.empty('No volumes attached', `Attach one:  mbd hosting vm volumes attach ${vmId} --size 50`);
      return;
    }
    print.table(
      [
        { header: 'ID',     key: 'id' },
        { header: 'DEVICE', key: 'device_name', format: (v) => (v ? String(v) : chalk.gray('–')) },
        { header: 'SIZE',   key: 'size_gb', align: 'right', format: (v) => (v === undefined ? chalk.gray('–') : `${String(v)} GB`) },
        { header: 'TYPE',   key: 'disk_type', format: (v) => (v ? String(v) : chalk.gray('–')) },
      ],
      result.volumes,
    );
  }));

  examples(
    vol
      .command('attach <vm-id>')
      .description('Create and attach a new disk to a running VM (charged to your hosting balance)')
      .requiredOption('--size <gb>', `Size in GB (${VOLUME_SIZE_GB.min}-${VOLUME_SIZE_GB.max})`)
      .option('--type <type>', `Disk type: ${DISK_TYPES.join('|')}`, 'pd-ssd')
      .option('-y, --yes', 'Skip the confirmation prompt'),
    ['mbd hosting vm volumes attach <vm-id> --size 100', 'mbd hosting vm volumes attach <vm-id> --size 500 --type pd-standard --yes'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, opts: { size: string; type: string; yes?: boolean }) => {
    const size = parseIntOption(opts.size, '--size', VOLUME_SIZE_GB.min, VOLUME_SIZE_GB.max);
    const type = validateChoice<DiskType>(opts.type, DISK_TYPES, '--type');
    if (isInteractive() && !opts.yes) {
      const ok = await clack.confirm({ message: `Attach a ${size} GB ${type} disk to VM ${vmId}? It is charged to your hosting balance.`, initialValue: true });
      if (clack.isCancel(ok) || !ok) cancelled();
    }
    const result = await withSpinner('Attaching volume', () => h.api.attachVolume(vmId, { size_gb: size, disk_type: type }));
    if (h.json) return print.json(result);
    print.success(`Attached ${result.size_gb} GB ${result.disk_type} volume ${chalk.cyan(result.volume_id)} (charged ${money(result.monthly_cost_cents)})`);
    print.hint('Format and mount it on the VM before use (e.g. mkfs.ext4, then mount).');
  }));

  examples(
    vol
      .command('detach <vm-id> <volume-id>')
      .alias('rm')
      .description('Detach a volume from a VM and DELETE the disk and its data')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting vm volumes detach <vm-id> <volume-id>'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, volumeId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({
      yes: opts.yes, json: h.json,
      message: `Detach volume ${volumeId} from VM ${vmId}? The disk and all its data are deleted. Take a snapshot first if you need it.`,
    });
    if (!ok) cancelled();
    const result = await withSpinner('Detaching volume', () => h.api.detachVolume(vmId, volumeId));
    if (h.json) return print.json(result);
    print.success(`Volume ${chalk.cyan(volumeId)} detached and deleted`);
  }));

  examples(
    vol.command('snapshot <vm-id> <volume-id>').description('Take a point-in-time snapshot of an attached volume'),
    ['mbd hosting vm volumes snapshot <vm-id> <volume-id>'],
  ).action(hostingAction(program, 'compute', async (h, vmId: string, volumeId: string) => {
    const result = await withSpinner('Creating snapshot', () => h.api.snapshotVolume(vmId, volumeId));
    if (h.json) return print.json(result);
    print.success(`Snapshot ${chalk.cyan(result.snapshot_name)} created (${result.status})`);
    print.hint('The API has no endpoint to list or restore snapshots yet; keep this name.');
  }));
}

// ─── firewall ────────────────────────────────────────────────────────────────

function addFirewallCommands(vmCmd: Command, program: Command): void {
  const fw = vmCmd.command('firewall').description('Open ports on your VMs');
  examples(fw, ['mbd hosting vm firewall list', 'mbd hosting vm firewall add <vm-id> --ports 443']);

  examples(
    fw.command('list').alias('ls').description('List firewall rules on your VMs'),
    ['mbd hosting vm firewall list', 'mbd --json hosting vm firewall list'],
  ).action(hostingAction(program, 'networking', async (h) => {
    const result = await withSpinner('Loading firewall rules', () => h.api.listFirewallRules());
    if (h.json) return print.json(result);
    const rules = result.rules ?? [];
    if (rules.length === 0) {
      print.empty('No firewall rules', 'Open a port:  mbd hosting vm firewall add <vm-id> --ports 443');
      return;
    }
    print.table(
      [
        { header: 'NAME',      key: 'name' },
        { header: 'DIRECTION', key: 'direction', format: (v) => String(v ?? '').toLowerCase() },
        { header: 'ALLOW',     key: 'allowed', format: (v) => (Array.isArray(v)
          ? (v as FirewallRule['allowed']).map((a) => (a.ports?.length ? `${a.protocol}/${a.ports.join(',')}` : a.protocol)).join(' ')
          : '–') },
        { header: 'SOURCES',   key: 'source_ranges', format: (v) => (Array.isArray(v) && v.length ? v.join(', ') : '–') },
        { header: 'VMS',       key: 'target_tags', format: (v) => (Array.isArray(v) && v.length ? v.join(', ') : '–') },
      ],
      rules,
    );
  }));

  examples(
    fw
      .command('add <vm-id>')
      .description('Add a firewall rule scoped to one VM (the API cannot remove rules yet)')
      .requiredOption('--ports <range>', 'Port or range, e.g. 8080 or 3000-3100')
      .option('--protocol <protocol>', 'tcp|udp|icmp', 'tcp')
      .option('--direction <direction>', 'ingress|egress', 'ingress')
      .option('--source <cidr>', 'Allowed source range; repeat for several (default 0.0.0.0/0)', collect, []),
    ['mbd hosting vm firewall add <vm-id> --ports 443', 'mbd hosting vm firewall add <vm-id> --ports 5432 --source 203.0.113.0/24'],
  ).action(hostingAction(program, 'networking', async (h, vmId: string, opts: {
    ports: string; protocol: string; direction: string; source: string[];
  }) => {
    const protocol = validateChoice(opts.protocol, ['tcp', 'udp', 'icmp'] as const, '--protocol');
    const direction = validateChoice(opts.direction, ['ingress', 'egress'] as const, '--direction');
    if (!/^\d{1,5}(-\d{1,5})?$/.test(opts.ports)) throw new UsageError(`--ports must be a port or range like 8080 or 3000-3100 (got "${opts.ports}").`);
    const result = await withSpinner('Adding firewall rule', () => h.api.addFirewallRule({
      vm_id: vmId,
      direction,
      protocol,
      port_range: opts.ports,
      source_ranges: opts.source.length > 0 ? opts.source : undefined,
    }));
    if (h.json) return print.json(result);
    const ruleName = typeof result.rule?.name === 'string' ? ` ${chalk.gray(result.rule.name)}` : '';
    print.success(`Opened ${protocol}/${opts.ports} (${direction}) on VM ${chalk.cyan(vmId)}${ruleName}`);
  }));
}

// ─── Log helpers ─────────────────────────────────────────────────────────────

export function tail(text: string, lines: number): string {
  const all = text.split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  return all.slice(-lines).join('\n');
}

/** Lines of `curr` that come after the end of `prev` (the console buffer only grows or rotates). */
export function newContent(prev: string, curr: string): string {
  if (!prev) return curr;
  if (curr.startsWith(prev)) return curr.slice(prev.length).replace(/^\n/, '');
  const prevLines = prev.split('\n').filter(Boolean);
  const currLines = curr.split('\n');
  const lastPrev = prevLines[prevLines.length - 1];
  const idx = lastPrev === undefined ? -1 : currLines.lastIndexOf(lastPrev);
  if (idx === -1) return curr;
  return currLines.slice(idx + 1).join('\n');
}

function printLogLines(text: string): void {
  for (const line of text.split('\n').filter(Boolean)) {
    if (/\b(ERROR|FATAL|CRIT)\b/i.test(line)) console.log('  ' + chalk.red(line));
    else if (/\b(WARN|WARNING)\b/i.test(line)) console.log('  ' + chalk.yellow(line));
    else console.log('  ' + chalk.gray(line));
  }
}
