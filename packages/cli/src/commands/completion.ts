/**
 * Shell completion, generated from the live Commander command tree.
 *
 * The shell scripts are thin: on <TAB> they call the hidden
 *   mbd __complete <words typed after "mbd"...> <current word>
 * which walks the real command tree and prints one candidate per line as
 * "name<TAB>description". New commands, aliases, options and option choices
 * therefore complete automatically; nothing is hand-maintained.
 *
 * Usage:
 *   eval "$(mbd completion bash)"          # ~/.bashrc
 *   eval "$(mbd completion zsh)"           # ~/.zshrc
 *   mbd completion fish | source           # fish
 *   mbd completion powershell | Out-String | Invoke-Expression   # $PROFILE
 */

import { Command, type Option } from 'commander';
import { UsageError } from '../lib/errors.js';
import { examples } from '../lib/command-utils.js';

export const COMPLETE_COMMAND = '__complete';
export const SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;

export interface Candidate {
  name: string;
  description: string;
}

function findOption(cmd: Command | null, flag: string): Option | undefined {
  for (let c = cmd; c; c = c.parent) {
    const opt = c.options.find((o) => o.long === flag || o.short === flag);
    if (opt) return opt;
  }
  return undefined;
}

function optionCandidates(cmd: Command): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let c: Command | null = cmd; c; c = c.parent) {
    for (const opt of c.createHelp().visibleOptions(c)) {
      const flag = opt.long ?? opt.short;
      if (!flag || seen.has(flag)) continue;
      seen.add(flag);
      out.push({ name: flag, description: opt.description ?? '' });
    }
  }
  return out;
}

function subcommandCandidates(cmd: Command): Candidate[] {
  const out: Candidate[] = [];
  for (const sub of cmd.createHelp().visibleCommands(cmd)) {
    if (sub.name() === 'help' || sub.name() === COMPLETE_COMMAND) continue;
    out.push({ name: sub.name(), description: sub.description() });
  }
  return out;
}

/**
 * Completion candidates for `words` (everything after the program name; the
 * last element is the word under the cursor, possibly empty).
 */
export function completionCandidates(program: Command, words: string[]): Candidate[] {
  const current = words.length > 0 ? words[words.length - 1] : '';
  let cmd = program;
  let pendingValue: Option | undefined;
  let positionalOnly = false;

  for (const word of words.slice(0, -1)) {
    if (pendingValue) {
      pendingValue = undefined;
      continue;
    }
    if (word === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && word.startsWith('-')) {
      if (!word.includes('=')) {
        const opt = findOption(cmd, word);
        if (opt?.required) pendingValue = opt;
      }
      continue;
    }
    const sub = cmd.commands.find((c) => c.name() === word || c.aliases().includes(word));
    if (sub) cmd = sub;
  }

  let candidates: Candidate[];
  if (pendingValue) {
    candidates = (pendingValue.argChoices ?? []).map((c) => ({ name: c, description: '' }));
  } else if (!positionalOnly && current.startsWith('-')) {
    candidates = optionCandidates(cmd);
  } else {
    candidates = subcommandCandidates(cmd);
  }
  return candidates.filter((c) => c.name.startsWith(current));
}

/** Handle `mbd __complete ...` before normal parsing (it must accept any words). */
export function runCompletion(program: Command, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const words = [...args];
  // Windows PowerShell 5.1 drops empty arguments, so its script signals an
  // empty current word through the environment instead.
  if (env.MBD_COMPLETE_EMPTY_WORD === '1') words.push('');
  for (const c of completionCandidates(program, words)) {
    process.stdout.write(c.description ? `${c.name}\t${c.description.replace(/\s+/g, ' ')}\n` : `${c.name}\n`);
  }
}

// ─── Shell scripts ────────────────────────────────────────────────────────────

const BASH = `###-begin-mbd-completions-###
# Moltbot Den CLI completion for bash. Add to ~/.bashrc:
#   eval "$(mbd completion bash)"
_mbd_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local out
  out=$("\${COMP_WORDS[0]}" ${COMPLETE_COMMAND} "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null) || return
  local IFS=$'\\n'
  COMPREPLY=( $(compgen -W "$(printf '%s\\n' "$out" | cut -f1)" -- "$cur") )
}
complete -F _mbd_completions -o default mbd moltbotden
###-end-mbd-completions-###`;

const ZSH = `#compdef mbd moltbotden
###-begin-mbd-completions-###
# Moltbot Den CLI completion for zsh. Add to ~/.zshrc:
#   eval "$(mbd completion zsh)"
_mbd() {
  local -a candidates
  local line name desc
  for line in "\${(@f)$(\${words[1]} ${COMPLETE_COMMAND} "\${(@)words[2,CURRENT]}" 2>/dev/null)}"; do
    [[ -z "$line" ]] && continue
    name="\${line%%$'\\t'*}"
    desc=""
    [[ "$line" == *$'\\t'* ]] && desc="\${line#*$'\\t'}"
    candidates+=("\${name//:/\\\\:}:$desc")
  done
  if (( \${#candidates} )); then
    _describe -t commands 'mbd' candidates
  else
    _files
  fi
}
if (( $+functions[compdef] )); then
  compdef _mbd mbd moltbotden
fi
###-end-mbd-completions-###`;

const FISH = `###-begin-mbd-completions-###
# Moltbot Den CLI completion for fish:
#   mbd completion fish > ~/.config/fish/completions/mbd.fish
function __mbd_complete
    set -l tokens (commandline -opc)
    set -l cur (commandline -ct)
    $tokens[1] ${COMPLETE_COMMAND} $tokens[2..-1] "$cur" 2>/dev/null
end
complete -c mbd -f -a '(__mbd_complete)'
complete -c moltbotden -f -a '(__mbd_complete)'
###-end-mbd-completions-###`;

const POWERSHELL = `###-begin-mbd-completions-###
# Moltbot Den CLI completion for PowerShell. Add to $PROFILE:
#   mbd completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName mbd, moltbotden -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $exe = $commandAst.CommandElements[0].ToString()
    $words = @($commandAst.CommandElements | Select-Object -Skip 1 |
        Where-Object { $_.Extent.EndOffset -le $cursorPosition } | ForEach-Object { $_.ToString() })
    if ($wordToComplete -eq '') { $env:MBD_COMPLETE_EMPTY_WORD = '1' }
    try {
        & $exe ${COMPLETE_COMMAND} @words 2>$null | ForEach-Object {
            $parts = $_ -split "\`t", 2
            $desc = if ($parts.Count -gt 1 -and $parts[1]) { $parts[1] } else { $parts[0] }
            [System.Management.Automation.CompletionResult]::new($parts[0], $parts[0], 'ParameterValue', $desc)
        }
    } finally {
        Remove-Item Env:MBD_COMPLETE_EMPTY_WORD -ErrorAction SilentlyContinue
    }
}
###-end-mbd-completions-###`;

const SCRIPTS: Record<(typeof SHELLS)[number], string> = { bash: BASH, zsh: ZSH, fish: FISH, powershell: POWERSHELL };

const INSTALL: Record<(typeof SHELLS)[number], string> = {
  bash: '# Add to ~/.bashrc:\neval "$(mbd completion bash)"',
  zsh: '# Add to ~/.zshrc:\neval "$(mbd completion zsh)"',
  fish: '# Install:\nmbd completion fish > ~/.config/fish/completions/mbd.fish',
  powershell: '# Add to $PROFILE:\nmbd completion powershell | Out-String | Invoke-Expression',
};

export function completionScript(shell: string): string {
  const script = (SCRIPTS as Record<string, string | undefined>)[shell];
  if (!script) throw new UsageError(`Unsupported shell '${shell}'. Use ${SHELLS.join(', ')}.`);
  return script;
}

function detectShell(env: NodeJS.ProcessEnv): (typeof SHELLS)[number] {
  if (process.platform === 'win32' && !env.SHELL) return 'powershell';
  const name = env.SHELL?.split(/[\\/]/).pop() ?? 'bash';
  return (SHELLS as readonly string[]).includes(name) ? (name as (typeof SHELLS)[number]) : 'bash';
}

export function addCompletionCommand(program: Command): void {
  program
    .command('completion [shell]')
    .description(`Generate a shell completion script (${SHELLS.join(', ')})`)
    .addHelpText('after', examples([
      'eval "$(mbd completion bash)"    # add to ~/.bashrc',
      'eval "$(mbd completion zsh)"     # add to ~/.zshrc',
      'mbd completion fish > ~/.config/fish/completions/mbd.fish',
      'mbd completion powershell | Out-String | Invoke-Expression   # add to $PROFILE',
    ]) + `
Completion is generated from the installed CLI's command tree, so it stays
correct after upgrades without regenerating the script.
`)
    .action(async (shellArg: string | undefined, _opts: unknown, cmd: Command) => {
      const json = Boolean(cmd.optsWithGlobals().json);
      let shell = shellArg;
      if (!shell) {
        shell = detectShell(process.env);
        if (!json) process.stderr.write(`# Detected shell: ${shell}\n${INSTALL[shell as (typeof SHELLS)[number]]}\n\n`);
      }
      const script = completionScript(shell);
      if (json) {
        console.log(JSON.stringify({ shell, script }));
        return;
      }
      process.stdout.write(script + '\n');
    });

  // Normally dispatched by cli.ts before Commander parses (so words like
  // "--json" are not taken as flags); this registration reserves the name.
  program
    .command(COMPLETE_COMMAND, { hidden: true })
    .allowUnknownOption()
    .argument('[words...]')
    .action((words: string[]) => runCompletion(program, words));
}
