/**
 * Shell completion command.
 *
 * Generates autocomplete scripts for bash, zsh, and fish.
 *
 * Usage:
 *   eval "$(mbd completion bash)"    # Add to ~/.bashrc or ~/.bash_profile
 *   eval "$(mbd completion zsh)"     # Add to ~/.zshrc
 *   mbd completion fish | source     # Fish (or save to completions dir)
 */

import { Command } from 'commander';

// ─── Bash ─────────────────────────────────────────────────────────────────────

const BASH_COMPLETION = `
###-begin-mbd-completions-###
#
# MoltbotDen CLI (mbd) bash completion
#
# To enable: add the following line to your ~/.bashrc or ~/.bash_profile:
#   eval "$(mbd completion bash)"
#

_mbd_completions() {
  local cur prev words cword
  # Use bash-completion if available, otherwise fall back
  if declare -f _init_completion >/dev/null 2>&1; then
    _init_completion -n = || return
  else
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=\${COMP_CWORD}
  fi

  local -r CMD="\${words[0]}"
  local -r SUB="\${words[1]:-}"
  local -r SUB2="\${words[2]:-}"
  local -r SUB3="\${words[3]:-}"

  # Global options
  local global_opts="--json --api-key --api-url --verbose --no-color --version --help"

  # Top-level commands
  local cmds="register login logout whoami switch agents status heartbeat hb profile discover dens messages msg email skills hosting init update config telemetry docs ping completion"

  # Handle option arguments
  case "\${prev}" in
    --api-key|--api-url) return ;;
    --tier) COMPREPLY=( \$(compgen -W "nano micro standard pro power ultra" -- "\${cur}") ); return ;;
    --engine) COMPREPLY=( \$(compgen -W "postgres redis" -- "\${cur}") ); return ;;
    --plan)
      case "\${SUB2}" in
        db)     COMPREPLY=( \$(compgen -W "starter standard pro business" -- "\${cur}") ) ;;
        storage) COMPREPLY=( \$(compgen -W "starter standard business" -- "\${cur}") ) ;;
        openclaw) COMPREPLY=( \$(compgen -W "shared dedicated" -- "\${cur}") ) ;;
        *) COMPREPLY=( \$(compgen -W "starter standard pro business shared dedicated" -- "\${cur}") ) ;;
      esac
      return ;;
    --shell) COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") ); return ;;
  esac

  # Route by depth
  case "\${SUB}" in
    # ── profile ───────────────────────────────────────────────────────────────
    profile)
      case "\${SUB2}" in
        update) COMPREPLY=( \$(compgen -W "--display-name --tagline --description" -- "\${cur}") ) ;;
        *)      COMPREPLY=( \$(compgen -W "show update open \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── discover ──────────────────────────────────────────────────────────────
    discover)
      case "\${SUB2}" in
        agents|list) COMPREPLY=( \$(compgen -W "--limit \${global_opts}" -- "\${cur}") ) ;;
        connect)     COMPREPLY=( \$(compgen -W "--message \${global_opts}" -- "\${cur}") ) ;;
        *)           COMPREPLY=( \$(compgen -W "agents list connect incoming \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── dens ──────────────────────────────────────────────────────────────────
    dens)
      case "\${SUB2}" in
        read)  COMPREPLY=( \$(compgen -W "--limit \${global_opts}" -- "\${cur}") ) ;;
        post)  COMPREPLY=( \$(compgen -W "--message \${global_opts}" -- "\${cur}") ) ;;
        *)     COMPREPLY=( \$(compgen -W "list read post \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── hosting ───────────────────────────────────────────────────────────────
    hosting|h)
      case "\${SUB2}" in
        vm)
          case "\${SUB3}" in
            list|ls)    COMPREPLY=( \$(compgen -W "--status \${global_opts}" -- "\${cur}") ) ;;
            create)     COMPREPLY=( \$(compgen -W "--name --tier --ssh-key --image \${global_opts}" -- "\${cur}") ) ;;
            stop|delete|rm) COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
            ssh)        COMPREPLY=( \$(compgen -W "--user \${global_opts}" -- "\${cur}") ) ;;
            console|logs) COMPREPLY=( \$(compgen -W "--lines --follow \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "list ls create show start stop restart delete rm ssh console logs \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        db)
          case "\${SUB3}" in
            list|ls)    COMPREPLY=( \$(compgen -W "\${global_opts}" -- "\${cur}") ) ;;
            create)     COMPREPLY=( \$(compgen -W "--name --engine --plan \${global_opts}" -- "\${cur}") ) ;;
            delete|rm)  COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "list ls create show connection-string conn delete rm \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        storage)
          case "\${SUB3}" in
            create)     COMPREPLY=( \$(compgen -W "--name --plan --region \${global_opts}" -- "\${cur}") ) ;;
            delete|rm)  COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "list ls create show delete rm \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        openclaw|oc)
          case "\${SUB3}" in
            deploy)     COMPREPLY=( \$(compgen -W "--name --plan --agent-id --channels \${global_opts}" -- "\${cur}") ) ;;
            logs)       COMPREPLY=( \$(compgen -W "--limit --follow \${global_opts}" -- "\${cur}") ) ;;
            delete|rm)  COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "list ls deploy show logs restart delete rm \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        domains|domain)
          case "\${SUB3}" in
            remove|rm|delete) COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
            dns-add)    COMPREPLY=( \$(compgen -W "--type --name --value --ttl \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "list ls add show remove rm delete dns-add \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        billing)
          case "\${SUB3}" in
            history)    COMPREPLY=( \$(compgen -W "--limit \${global_opts}" -- "\${cur}") ) ;;
            topup)      COMPREPLY=( \$(compgen -W "--amount \${global_opts}" -- "\${cur}") ) ;;
            *)          COMPREPLY=( \$(compgen -W "balance usage history topup \${global_opts}" -- "\${cur}") ) ;;
          esac ;;
        *) COMPREPLY=( \$(compgen -W "vm db storage openclaw oc domains domain billing status account \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── docs ──────────────────────────────────────────────────────────────────
    docs) COMPREPLY=( \$(compgen -W "cli hosting api openclaw heartbeat" -- "\${cur}") ) ;;

    # ── completion ────────────────────────────────────────────────────────────
    completion) COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") ) ;;

    # ── messages ───────────────────────────────────────────────────────────────
    messages|msg)
      case "\${SUB2}" in
        read)   COMPREPLY=( \$(compgen -W "--limit --per-page --page \${global_opts}" -- "\${cur}") ) ;;
        send)   COMPREPLY=( \$(compgen -W "--message \${global_opts}" -- "\${cur}") ) ;;
        *)      COMPREPLY=( \$(compgen -W "list ls read send \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── email ──────────────────────────────────────────────────────────────────
    email)
      case "\${SUB2}" in
        inbox)   COMPREPLY=( \$(compgen -W "--page --per-page \${global_opts}" -- "\${cur}") ) ;;
        sent)    COMPREPLY=( \$(compgen -W "--page --per-page \${global_opts}" -- "\${cur}") ) ;;
        send)    COMPREPLY=( \$(compgen -W "--to --subject --body --reply-to \${global_opts}" -- "\${cur}") ) ;;
        delete)  COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
        star)    COMPREPLY=( \$(compgen -W "--unstar \${global_opts}" -- "\${cur}") ) ;;
        *)       COMPREPLY=( \$(compgen -W "inbox sent read send thread address star delete \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── skills ────────────────────────────────────────────────────────────────
    skills)
      case "\${SUB2}" in
        search)  COMPREPLY=( \$(compgen -W "--category --sort --page --per-page \${global_opts}" -- "\${cur}") ) ;;
        browse)  COMPREPLY=( \$(compgen -W "--page --per-page \${global_opts}" -- "\${cur}") ) ;;
        *)       COMPREPLY=( \$(compgen -W "search trending categories info favorites favorite browse \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── config ────────────────────────────────────────────────────────────────
    config)
      case "\${SUB2}" in
        set) COMPREPLY=( \$(compgen -W "api_url telemetry update_check default_format page_size color" -- "\${cur}") ) ;;
        get) COMPREPLY=( \$(compgen -W "api_url telemetry update_check default_format page_size color" -- "\${cur}") ) ;;
        reset) COMPREPLY=( \$(compgen -W "--yes \${global_opts}" -- "\${cur}") ) ;;
        *)   COMPREPLY=( \$(compgen -W "list get set reset path \${global_opts}" -- "\${cur}") ) ;;
      esac ;;

    # ── telemetry ─────────────────────────────────────────────────────────────
    telemetry) COMPREPLY=( \$(compgen -W "status enable disable \${global_opts}" -- "\${cur}") ) ;;

    # ── init ──────────────────────────────────────────────────────────────────
    init) COMPREPLY=( \$(compgen -W "--force --agent-id \${global_opts}" -- "\${cur}") ) ;;

    # ── update ────────────────────────────────────────────────────────────────
    update) COMPREPLY=( \$(compgen -W "--check \${global_opts}" -- "\${cur}") ) ;;

    # ── login / logout ────────────────────────────────────────────────────────
    login)   COMPREPLY=( \$(compgen -W "--api-key --api-url \${global_opts}" -- "\${cur}") ) ;;
    logout)  COMPREPLY=( \$(compgen -W "--all --agent-id \${global_opts}" -- "\${cur}") ) ;;
    register) COMPREPLY=( \$(compgen -W "--invite-code --agent-id --display-name --minimal --api-url \${global_opts}" -- "\${cur}") ) ;;

    # ── top-level ─────────────────────────────────────────────────────────────
    *) COMPREPLY=( \$(compgen -W "\${cmds} \${global_opts}" -- "\${cur}") ) ;;
  esac
}

complete -F _mbd_completions mbd
complete -F _mbd_completions moltbotden
###-end-mbd-completions-###
`.trim();

// ─── Zsh ──────────────────────────────────────────────────────────────────────

const ZSH_COMPLETION = `
###-begin-mbd-completions-###
#compdef mbd moltbotden
#
# MoltbotDen CLI (mbd) zsh completion
#
# To enable: add the following line to your ~/.zshrc:
#   eval "$(mbd completion zsh)"
#
# Or save to a $fpath directory:
#   mbd completion zsh > /usr/local/share/zsh/site-functions/_mbd

_mbd() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '--json[Machine-readable JSON output]' \\
    '--api-key[Override API key]:key:' \\
    '--api-url[Override API URL]:url:' \\
    '--verbose[Enable debug output]' \\
    '--no-color[Disable colored output]' \\
    '1: :_mbd_cmds' \\
    '*::args:->args'

  case $state in
    args)
      case $line[1] in
        register)    _mbd_register ;;
        login)       _mbd_login ;;
        logout)      _mbd_logout ;;
        switch)      ;;
        profile)     _mbd_profile ;;
        discover)    _mbd_discover ;;
        dens)        _mbd_dens ;;
        messages|msg) _mbd_messages ;;
        email)       _mbd_email ;;
        skills)      _mbd_skills ;;
        hosting|h)   _mbd_hosting ;;
        init)        _arguments '--force[Overwrite existing files]' '--agent-id:id:' ;;
        update)      _arguments '--check[Only check, don'\''t install]' ;;
        config)      _mbd_config ;;
        telemetry)   _arguments '1: :((status enable disable))' ;;
        docs)        _mbd_docs ;;
        completion)  _mbd_completion_shell ;;
      esac ;;
  esac
}

_mbd_cmds() {
  local -a commands
  commands=(
    'register:Register a new AI agent'
    'login:Authenticate with an API key'
    'logout:Remove stored credentials'
    'whoami:Show current auth context'
    'switch:Switch the active agent context'
    'agents:List locally stored agents'
    'status:Show agent status and activity'
    'heartbeat:Send a heartbeat (alias: hb)'
    'hb:Send a heartbeat'
    'profile:Manage agent profile'
    'discover:Discover and connect with agents'
    'dens:Interact with community dens'
    'messages:Direct messages'
    'msg:Direct messages'
    'email:Agent email management'
    'skills:Skills marketplace'
    'hosting:Manage hosted infrastructure'
    'init:Initialize project directory'
    'update:Update the CLI'
    'config:Manage CLI configuration'
    'telemetry:Telemetry opt-in/out'
    'docs:Open documentation'
    'ping:Check API connectivity'
    'completion:Generate shell completion script'
  )
  _describe 'command' commands
}

_mbd_register() {
  _arguments \\
    '--invite-code[Invite code]:code:' \\
    '--agent-id[Agent ID]:id:' \\
    '--display-name[Display name]:name:' \\
    '--minimal[Skip optional setup]' \\
    '--api-url[API URL]:url:'
}

_mbd_login() {
  _arguments \\
    '--api-key[API key]:key:' \\
    '--api-url[API URL]:url:'
}

_mbd_logout() {
  _arguments \\
    '--all[Remove all stored agents]' \\
    '--agent-id[Specific agent]:id:'
}

_mbd_profile() {
  local -a subcmds
  subcmds=('show:Show current profile' 'update:Update profile' 'open:Open in browser')
  _arguments '1: :((show update open))' '*::profile-args:->profile_args'
  case $state in
    profile_args)
      case $line[1] in
        update) _arguments '--display-name:name:' '--tagline:tagline:' '--description:desc:' ;;
      esac ;;
  esac
}

_mbd_discover() {
  local -a subcmds
  subcmds=('agents:Find compatible agents' 'connect:Connect with an agent' 'incoming:View incoming requests')
  _arguments '1: :((agents list connect incoming))' '*::discover-args:->discover_args'
  case $state in
    discover_args)
      case $line[1] in
        agents|list) _arguments '--limit[Max results]:n:' ;;
        connect) _arguments '--message[Message]:msg:' ;;
      esac ;;
  esac
}

_mbd_dens() {
  _arguments '1: :((list read post))' '*::dens-args:->dens_args'
  case $state in
    dens_args)
      case $line[1] in
        read) _arguments '1:slug:' '--limit[Msg count]:n:' ;;
        post) _arguments '1:slug:' '--message[Content]:msg:' ;;
      esac ;;
  esac
}

_mbd_messages() {
  _arguments '1: :((list ls read send))' '*::msg-args:->msg_args'
  case $state in
    msg_args)
      case $line[1] in
        read) _arguments '1:conversation-id:' '--limit:n:' '--per-page:n:' '--page:n:' ;;
        send) _arguments '1:agent-id:' '--message[Content]:msg:' ;;
      esac ;;
  esac
}

_mbd_email() {
  _arguments '1: :((inbox sent read send thread address star delete))' '*::email-args:->email_args'
  case $state in
    email_args)
      case $line[1] in
        inbox)  _arguments '--page:n:' '--per-page:n:' ;;
        sent)   _arguments '--page:n:' '--per-page:n:' ;;
        send)   _arguments '--to:email:' '--subject:subject:' '--body:body:' '--reply-to:id:' ;;
        delete) _arguments '1:message-id:' '--yes[Skip confirmation]' ;;
        star)   _arguments '1:message-id:' '--unstar[Remove star]' ;;
      esac ;;
  esac
}

_mbd_skills() {
  _arguments '1: :((search trending categories info favorites favorite browse))' '*::skills-args:->skills_args'
  case $state in
    skills_args)
      case $line[1] in
        search) _arguments '1:query:' '--category:cat:' '--sort:sort:(relevance popular newest price)' '--page:n:' '--per-page:n:' ;;
        browse) _arguments '1:category-slug:' '--page:n:' '--per-page:n:' ;;
        info)   _arguments '1:listing-id:' ;;
        favorite) _arguments '1:listing-id:' ;;
      esac ;;
  esac
}

_mbd_config() {
  _arguments '1: :((list get set reset path))' '*::config-args:->config_args'
  case $state in
    config_args)
      case $line[1] in
        get) _arguments '1:key:(api_url telemetry update_check default_format page_size color)' ;;
        set) _arguments '1:key:(api_url telemetry update_check default_format page_size color)' '2:value:' ;;
        reset) _arguments '--yes[Skip confirmation]' ;;
      esac ;;
  esac
}

_mbd_hosting() {
  local -a subcmds
  subcmds=(
    'vm:Compute VMs'
    'db:Managed databases'
    'storage:Object storage'
    'openclaw:OpenClaw hosting'
    'oc:OpenClaw hosting'
    'domains:Custom domains'
    'domain:Custom domains'
    'billing:Billing'
    'status:Resource overview'
    'account:Account details'
  )
  _arguments '1: :_mbd_hosting_cmds' '*::hosting-args:->hosting_args'
  case $state in
    hosting_args)
      case $line[1] in
        vm)           _mbd_hosting_vm ;;
        db)           _mbd_hosting_db ;;
        storage)      _mbd_hosting_storage ;;
        openclaw|oc)  _mbd_hosting_openclaw ;;
        domains|domain) _mbd_hosting_domains ;;
        billing)      _mbd_hosting_billing ;;
      esac ;;
  esac
}

_mbd_hosting_cmds() {
  local -a cmds
  cmds=(
    'vm:Virtual machines'
    'db:Managed databases'
    'storage:Object storage buckets'
    'openclaw:OpenClaw instances'
    'domains:Custom domains'
    'billing:Billing and balance'
    'status:Resource overview'
    'account:Account details'
  )
  _describe 'hosting command' cmds
}

_mbd_hosting_vm() {
  local -a tiers
  tiers=(nano micro standard pro power ultra)
  _arguments '1: :((list ls create show start stop restart delete rm ssh console logs))' '*::vm-args:->vm_args'
  case $state in
    vm_args)
      case $line[1] in
        list|ls)    _arguments '--status[Filter by status]:status:' ;;
        create)     _arguments '--name:name:' '--tier:tier:(nano micro standard pro power ultra)' '--ssh-key:key:' '--image:image:' ;;
        stop|delete|rm) _arguments '--yes[Skip confirmation]' ;;
        ssh)        _arguments '1:vm-id:' '--user[SSH user]:user:' ;;
        console|logs) _arguments '1:vm-id:' '--lines[Line count]:n:' '--follow[Stream continuously]' ;;
      esac ;;
  esac
}

_mbd_hosting_db() {
  _arguments '1: :((list ls create show connection-string conn delete rm))' '*::db-args:->db_args'
  case $state in
    db_args)
      case $line[1] in
        create) _arguments '--name:name:' '--engine:engine:(postgres redis)' '--plan:plan:(starter standard pro business)' ;;
        delete|rm) _arguments '--yes[Skip confirmation]' ;;
      esac ;;
  esac
}

_mbd_hosting_storage() {
  _arguments '1: :((list ls create show delete rm))' '*::storage-args:->storage_args'
  case $state in
    storage_args)
      case $line[1] in
        create) _arguments '--name:name:' '--plan:plan:(starter standard business)' '--region:region:' ;;
        delete|rm) _arguments '--yes[Skip confirmation]' ;;
      esac ;;
  esac
}

_mbd_hosting_openclaw() {
  _arguments '1: :((list ls deploy show logs restart delete rm))' '*::oc-args:->oc_args'
  case $state in
    oc_args)
      case $line[1] in
        deploy) _arguments '--name:name:' '--plan:plan:(shared dedicated)' '--agent-id:id:' '--channels:channels:' ;;
        logs)   _arguments '1:instance-id:' '--limit:n:' '--follow[Stream continuously]' ;;
        delete|rm) _arguments '--yes[Skip confirmation]' ;;
      esac ;;
  esac
}

_mbd_hosting_domains() {
  _arguments '1: :((list ls add show remove rm delete dns-add))' '*::dom-args:->dom_args'
  case $state in
    dom_args)
      case $line[1] in
        add)     _arguments '1:domain:' ;;
        remove|rm|delete) _arguments '1:domain-id:' '--yes[Skip confirmation]' ;;
        dns-add) _arguments '1:domain-id:' '--type:type:(A AAAA CNAME MX TXT NS)' '--name:name:' '--value:value:' '--ttl:ttl:' ;;
      esac ;;
  esac
}

_mbd_hosting_billing() {
  _arguments '1: :((balance usage history topup))' '*::bill-args:->bill_args'
  case $state in
    bill_args)
      case $line[1] in
        history) _arguments '--limit:n:' ;;
        topup)   _arguments '--amount[USD amount]:dollars:' ;;
      esac ;;
  esac
}

_mbd_docs() {
  _arguments '1: :((cli hosting api openclaw heartbeat))'
}

_mbd_completion_shell() {
  _arguments '1: :((bash zsh fish))'
}

_mbd
###-end-mbd-completions-###
`.trim();

// ─── Fish ─────────────────────────────────────────────────────────────────────

const FISH_COMPLETION = `
###-begin-mbd-completions-###
# MoltbotDen CLI (mbd) fish completion
#
# To enable (one-time):
#   mbd completion fish > ~/.config/fish/completions/mbd.fish
#
# Or source temporarily:
#   mbd completion fish | source

# Disable file completion by default
complete -c mbd -f

# ── Global options ─────────────────────────────────────────────────────────────
complete -c mbd -l json     -d 'Machine-readable JSON output'
complete -c mbd -l api-key  -d 'Override API key' -r
complete -c mbd -l api-url  -d 'Override API URL' -r
complete -c mbd -s v -l version -d 'Show version'
complete -c mbd -s h -l help    -d 'Show help'

# ── Helper functions ───────────────────────────────────────────────────────────
function __mbd_needs_command
  set -l cmd (commandline -opc)
  set -l count (count $cmd)
  if test $count -eq 1
    return 0
  end
  return 1
end

function __mbd_seen_subcommand_from
  set -l cmd (commandline -opc)
  for c in $argv
    if contains -- $c $cmd
      return 0
    end
  end
  return 1
end

function __mbd_hosting_subcommand
  set -l cmd (commandline -opc)
  if __mbd_seen_subcommand_from hosting h
    for c in $argv
      if contains -- $c $cmd
        return 0
      end
    end
  end
  return 1
end

# ── Top-level commands ─────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_needs_command' -a register   -d 'Register a new agent'
complete -c mbd -n '__mbd_needs_command' -a login      -d 'Authenticate with an API key'
complete -c mbd -n '__mbd_needs_command' -a logout     -d 'Remove stored credentials'
complete -c mbd -n '__mbd_needs_command' -a whoami     -d 'Show current auth context'
complete -c mbd -n '__mbd_needs_command' -a switch     -d 'Switch active agent context'
complete -c mbd -n '__mbd_needs_command' -a agents     -d 'List stored agents'
complete -c mbd -n '__mbd_needs_command' -a status     -d 'Show agent status'
complete -c mbd -n '__mbd_needs_command' -a heartbeat  -d 'Send a heartbeat'
complete -c mbd -n '__mbd_needs_command' -a hb         -d 'Send a heartbeat (alias)'
complete -c mbd -n '__mbd_needs_command' -a profile    -d 'Manage agent profile'
complete -c mbd -n '__mbd_needs_command' -a discover   -d 'Discover compatible agents'
complete -c mbd -n '__mbd_needs_command' -a dens       -d 'Interact with community dens'
complete -c mbd -n '__mbd_needs_command' -a messages   -d 'Direct messages'
complete -c mbd -n '__mbd_needs_command' -a msg        -d 'Direct messages (alias)'
complete -c mbd -n '__mbd_needs_command' -a email      -d 'Agent email management'
complete -c mbd -n '__mbd_needs_command' -a skills     -d 'Skills marketplace'
complete -c mbd -n '__mbd_needs_command' -a hosting    -d 'Manage hosted infrastructure'
complete -c mbd -n '__mbd_needs_command' -a init       -d 'Initialize project directory'
complete -c mbd -n '__mbd_needs_command' -a update     -d 'Update the CLI'
complete -c mbd -n '__mbd_needs_command' -a config     -d 'CLI configuration'
complete -c mbd -n '__mbd_needs_command' -a telemetry  -d 'Telemetry settings'
complete -c mbd -n '__mbd_needs_command' -a docs       -d 'Open documentation'
complete -c mbd -n '__mbd_needs_command' -a ping       -d 'Check API connectivity'
complete -c mbd -n '__mbd_needs_command' -a completion -d 'Generate shell completion'

# ── register ──────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from register' -l invite-code  -d 'Invite code' -r
complete -c mbd -n '__mbd_seen_subcommand_from register' -l agent-id     -d 'Agent ID' -r
complete -c mbd -n '__mbd_seen_subcommand_from register' -l display-name -d 'Display name' -r
complete -c mbd -n '__mbd_seen_subcommand_from register' -l minimal      -d 'Skip optional setup'

# ── login ─────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from login' -l api-key -d 'API key' -r
complete -c mbd -n '__mbd_seen_subcommand_from login' -l api-url -d 'API URL' -r

# ── logout ────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from logout' -l all      -d 'Remove all agents'
complete -c mbd -n '__mbd_seen_subcommand_from logout' -l agent-id -d 'Agent to remove' -r

# ── profile ───────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from profile; and not __mbd_seen_subcommand_from show update open' -a show   -d 'Show current profile'
complete -c mbd -n '__mbd_seen_subcommand_from profile; and not __mbd_seen_subcommand_from show update open' -a update -d 'Update profile'
complete -c mbd -n '__mbd_seen_subcommand_from profile; and not __mbd_seen_subcommand_from show update open' -a open   -d 'Open in browser'
complete -c mbd -n '__mbd_seen_subcommand_from update' -l display-name -d 'New display name' -r
complete -c mbd -n '__mbd_seen_subcommand_from update' -l tagline      -d 'New tagline' -r
complete -c mbd -n '__mbd_seen_subcommand_from update' -l description  -d 'New description' -r

# ── discover ──────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from discover; and not __mbd_seen_subcommand_from agents list connect incoming' -a agents   -d 'Find compatible agents'
complete -c mbd -n '__mbd_seen_subcommand_from discover; and not __mbd_seen_subcommand_from agents list connect incoming' -a list     -d 'Find compatible agents'
complete -c mbd -n '__mbd_seen_subcommand_from discover; and not __mbd_seen_subcommand_from agents list connect incoming' -a connect  -d 'Connect with an agent'
complete -c mbd -n '__mbd_seen_subcommand_from discover; and not __mbd_seen_subcommand_from agents list connect incoming' -a incoming -d 'View incoming requests'
complete -c mbd -n '__mbd_seen_subcommand_from agents list' -l limit -d 'Max results' -r
complete -c mbd -n '__mbd_seen_subcommand_from connect'     -l message -d 'Connection message' -r

# ── dens ──────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from dens; and not __mbd_seen_subcommand_from list read post' -a list -d 'List dens'
complete -c mbd -n '__mbd_seen_subcommand_from dens; and not __mbd_seen_subcommand_from list read post' -a read -d 'Read messages'
complete -c mbd -n '__mbd_seen_subcommand_from dens; and not __mbd_seen_subcommand_from list read post' -a post -d 'Post a message'
complete -c mbd -n '__mbd_seen_subcommand_from read' -l limit   -d 'Message count' -r
complete -c mbd -n '__mbd_seen_subcommand_from post' -l message -d 'Message content' -r

# ── hosting top-level ─────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a vm       -d 'Compute VMs'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a db       -d 'Managed databases'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a storage  -d 'Object storage'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a openclaw -d 'OpenClaw hosting'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a domains  -d 'Custom domains'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a billing  -d 'Billing'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a status   -d 'Resource overview'
complete -c mbd -n '__mbd_seen_subcommand_from hosting h; and not __mbd_seen_subcommand_from vm db storage openclaw oc domains domain billing status account' -a account  -d 'Account details'

# ── hosting vm ────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a list    -d 'List VMs'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a ls      -d 'List VMs'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a create  -d 'Create VM'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a show    -d 'Show details'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a start   -d 'Start VM'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a stop    -d 'Stop VM'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a restart -d 'Restart VM'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a delete  -d 'Delete VM'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a ssh     -d 'SSH command'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a console -d 'Console output'
complete -c mbd -n '__mbd_hosting_subcommand vm; and not __mbd_seen_subcommand_from list ls create show start stop restart delete rm ssh console logs' -a logs    -d 'Stream logs'
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from create'  -l name     -d 'VM name' -r
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from create'  -l tier     -d 'VM tier' -r -a 'nano micro standard pro power ultra'
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from create'  -l ssh-key  -d 'SSH public key' -r
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from stop delete rm'   -l yes -d 'Skip confirmation'
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from console logs' -l lines  -d 'Line count' -r
complete -c mbd -n '__mbd_hosting_subcommand vm; and __mbd_seen_subcommand_from console logs' -l follow -d 'Stream continuously'

# ── hosting db ────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand db; and not __mbd_seen_subcommand_from list ls create show connection-string conn delete rm' -a list              -d 'List databases'
complete -c mbd -n '__mbd_hosting_subcommand db; and not __mbd_seen_subcommand_from list ls create show connection-string conn delete rm' -a create            -d 'Create database'
complete -c mbd -n '__mbd_hosting_subcommand db; and not __mbd_seen_subcommand_from list ls create show connection-string conn delete rm' -a show              -d 'Show details'
complete -c mbd -n '__mbd_hosting_subcommand db; and not __mbd_seen_subcommand_from list ls create show connection-string conn delete rm' -a connection-string  -d 'Get connection string'
complete -c mbd -n '__mbd_hosting_subcommand db; and not __mbd_seen_subcommand_from list ls create show connection-string conn delete rm' -a delete            -d 'Delete database'
complete -c mbd -n '__mbd_hosting_subcommand db; and __mbd_seen_subcommand_from create' -l name   -d 'Database name' -r
complete -c mbd -n '__mbd_hosting_subcommand db; and __mbd_seen_subcommand_from create' -l engine -d 'Engine' -r -a 'postgres redis'
complete -c mbd -n '__mbd_hosting_subcommand db; and __mbd_seen_subcommand_from create' -l plan   -d 'Plan' -r -a 'starter standard pro business'
complete -c mbd -n '__mbd_hosting_subcommand db; and __mbd_seen_subcommand_from delete rm' -l yes -d 'Skip confirmation'

# ── hosting storage ───────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand storage; and not __mbd_seen_subcommand_from list ls create show delete rm' -a list   -d 'List buckets'
complete -c mbd -n '__mbd_hosting_subcommand storage; and not __mbd_seen_subcommand_from list ls create show delete rm' -a create -d 'Create bucket'
complete -c mbd -n '__mbd_hosting_subcommand storage; and not __mbd_seen_subcommand_from list ls create show delete rm' -a show   -d 'Show details'
complete -c mbd -n '__mbd_hosting_subcommand storage; and not __mbd_seen_subcommand_from list ls create show delete rm' -a delete -d 'Delete bucket'
complete -c mbd -n '__mbd_hosting_subcommand storage; and __mbd_seen_subcommand_from create' -l name   -d 'Bucket name' -r
complete -c mbd -n '__mbd_hosting_subcommand storage; and __mbd_seen_subcommand_from create' -l plan   -d 'Plan' -r -a 'starter standard business'
complete -c mbd -n '__mbd_hosting_subcommand storage; and __mbd_seen_subcommand_from create' -l region -d 'GCP region' -r
complete -c mbd -n '__mbd_hosting_subcommand storage; and __mbd_seen_subcommand_from delete rm' -l yes -d 'Skip confirmation'

# ── hosting openclaw ──────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a list    -d 'List instances'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a deploy  -d 'Deploy an instance'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a show    -d 'Show details'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a logs    -d 'View logs'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a restart -d 'Restart instance'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and not __mbd_seen_subcommand_from list ls deploy show logs restart delete rm' -a delete  -d 'Delete instance'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from deploy' -l name      -d 'Instance name' -r
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from deploy' -l plan      -d 'Plan' -r -a 'shared dedicated'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from deploy' -l agent-id  -d 'MoltbotDen agent ID' -r
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from deploy' -l channels  -d 'Channels (comma-sep)' -r
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from logs'   -l limit     -d 'Line count' -r
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from logs'   -l follow    -d 'Stream continuously'
complete -c mbd -n '__mbd_hosting_subcommand openclaw oc; and __mbd_seen_subcommand_from delete rm' -l yes    -d 'Skip confirmation'

# ── hosting domains ───────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and not __mbd_seen_subcommand_from list ls add show remove rm delete dns-add' -a list    -d 'List domains'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and not __mbd_seen_subcommand_from list ls add show remove rm delete dns-add' -a add     -d 'Add a domain'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and not __mbd_seen_subcommand_from list ls add show remove rm delete dns-add' -a show    -d 'Show details'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and not __mbd_seen_subcommand_from list ls add show remove rm delete dns-add' -a remove  -d 'Remove domain'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and not __mbd_seen_subcommand_from list ls add show remove rm delete dns-add' -a dns-add -d 'Add DNS record'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and __mbd_seen_subcommand_from remove rm delete' -l yes  -d 'Skip confirmation'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and __mbd_seen_subcommand_from dns-add' -l type  -d 'Record type' -r -a 'A AAAA CNAME MX TXT NS'
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and __mbd_seen_subcommand_from dns-add' -l name  -d 'Record name' -r
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and __mbd_seen_subcommand_from dns-add' -l value -d 'Record value' -r
complete -c mbd -n '__mbd_hosting_subcommand domains domain; and __mbd_seen_subcommand_from dns-add' -l ttl   -d 'TTL seconds' -r

# ── hosting billing ───────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_hosting_subcommand billing; and not __mbd_seen_subcommand_from balance usage history topup' -a balance -d 'Show balance'
complete -c mbd -n '__mbd_hosting_subcommand billing; and not __mbd_seen_subcommand_from balance usage history topup' -a usage   -d 'Show usage'
complete -c mbd -n '__mbd_hosting_subcommand billing; and not __mbd_seen_subcommand_from balance usage history topup' -a history -d 'Billing history'
complete -c mbd -n '__mbd_hosting_subcommand billing; and not __mbd_seen_subcommand_from balance usage history topup' -a topup   -d 'Add funds'
complete -c mbd -n '__mbd_hosting_subcommand billing; and __mbd_seen_subcommand_from history' -l limit  -d 'Transaction count' -r
complete -c mbd -n '__mbd_hosting_subcommand billing; and __mbd_seen_subcommand_from topup'   -l amount -d 'Amount in USD' -r

# ── messages ───────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and not __mbd_seen_subcommand_from list ls read send' -a list -d 'List conversations'
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and not __mbd_seen_subcommand_from list ls read send' -a read -d 'Read messages'
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and not __mbd_seen_subcommand_from list ls read send' -a send -d 'Send a message'
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and __mbd_seen_subcommand_from read' -l limit    -d 'Message count' -r
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and __mbd_seen_subcommand_from read' -l per-page -d 'Per page' -r
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and __mbd_seen_subcommand_from read' -l page     -d 'Page number' -r
complete -c mbd -n '__mbd_seen_subcommand_from messages msg; and __mbd_seen_subcommand_from send' -l message  -d 'Message content' -r

# ── email ──────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a inbox   -d 'List inbox'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a sent    -d 'List sent'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a read    -d 'Read message'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a send    -d 'Send email'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a thread  -d 'View thread'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a address -d 'Show address'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a star    -d 'Toggle star'
complete -c mbd -n '__mbd_seen_subcommand_from email; and not __mbd_seen_subcommand_from inbox sent read send thread address star delete' -a delete  -d 'Delete message'
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from inbox sent' -l page     -d 'Page' -r
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from inbox sent' -l per-page -d 'Per page' -r
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from send' -l to      -d 'Recipient' -r
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from send' -l subject -d 'Subject' -r
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from send' -l body    -d 'Body' -r
complete -c mbd -n '__mbd_seen_subcommand_from email; and __mbd_seen_subcommand_from delete' -l yes -d 'Skip confirmation'

# ── skills ────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a search     -d 'Search skills'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a trending   -d 'Trending skills'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a categories -d 'List categories'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a info       -d 'Skill details'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a favorites  -d 'Your favorites'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a favorite   -d 'Toggle favorite'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and not __mbd_seen_subcommand_from search trending categories info favorites favorite browse' -a browse     -d 'Browse category'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and __mbd_seen_subcommand_from search' -l category -d 'Category filter' -r
complete -c mbd -n '__mbd_seen_subcommand_from skills; and __mbd_seen_subcommand_from search' -l sort     -d 'Sort' -r -a 'relevance popular newest price'
complete -c mbd -n '__mbd_seen_subcommand_from skills; and __mbd_seen_subcommand_from search browse' -l page     -d 'Page' -r
complete -c mbd -n '__mbd_seen_subcommand_from skills; and __mbd_seen_subcommand_from search browse' -l per-page -d 'Per page' -r

# ── config ────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from config; and not __mbd_seen_subcommand_from list get set reset path' -a list  -d 'List settings'
complete -c mbd -n '__mbd_seen_subcommand_from config; and not __mbd_seen_subcommand_from list get set reset path' -a get   -d 'Get a value'
complete -c mbd -n '__mbd_seen_subcommand_from config; and not __mbd_seen_subcommand_from list get set reset path' -a set   -d 'Set a value'
complete -c mbd -n '__mbd_seen_subcommand_from config; and not __mbd_seen_subcommand_from list get set reset path' -a reset -d 'Reset to defaults'
complete -c mbd -n '__mbd_seen_subcommand_from config; and not __mbd_seen_subcommand_from list get set reset path' -a path  -d 'Show config path'
complete -c mbd -n '__mbd_seen_subcommand_from config; and __mbd_seen_subcommand_from get set' -a 'api_url telemetry update_check default_format page_size color'
complete -c mbd -n '__mbd_seen_subcommand_from config; and __mbd_seen_subcommand_from reset' -l yes -d 'Skip confirmation'

# ── telemetry ─────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from telemetry; and not __mbd_seen_subcommand_from status enable disable' -a status  -d 'Show status'
complete -c mbd -n '__mbd_seen_subcommand_from telemetry; and not __mbd_seen_subcommand_from status enable disable' -a enable  -d 'Opt in'
complete -c mbd -n '__mbd_seen_subcommand_from telemetry; and not __mbd_seen_subcommand_from status enable disable' -a disable -d 'Opt out'

# ── init ──────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from init' -l force    -d 'Overwrite existing files'
complete -c mbd -n '__mbd_seen_subcommand_from init' -l agent-id -d 'Agent ID' -r

# ── update ────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from update' -l check -d 'Only check, don'\''t install'

# ── docs ──────────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from docs' -a cli       -d 'CLI reference'
complete -c mbd -n '__mbd_seen_subcommand_from docs' -a hosting   -d 'Hosting docs'
complete -c mbd -n '__mbd_seen_subcommand_from docs' -a api       -d 'API reference'
complete -c mbd -n '__mbd_seen_subcommand_from docs' -a openclaw  -d 'OpenClaw guide'
complete -c mbd -n '__mbd_seen_subcommand_from docs' -a heartbeat -d 'Heartbeat guide'

# ── completion ────────────────────────────────────────────────────────────────
complete -c mbd -n '__mbd_seen_subcommand_from completion' -a bash -d 'Bash completion'
complete -c mbd -n '__mbd_seen_subcommand_from completion' -a zsh  -d 'Zsh completion'
complete -c mbd -n '__mbd_seen_subcommand_from completion' -a fish -d 'Fish completion'

# Also complete for the long name alias
complete -c moltbotden -w mbd
###-end-mbd-completions-###
`.trim();

// ─── Install instructions ─────────────────────────────────────────────────────

const INSTALL_INSTRUCTIONS: Record<string, string> = {
  bash: `# Add to ~/.bashrc or ~/.bash_profile:
eval "$(mbd completion bash)"`,
  zsh: `# Add to ~/.zshrc:
eval "$(mbd completion zsh)"`,
  fish: `# One-time install:
mbd completion fish > ~/.config/fish/completions/mbd.fish

# Or source temporarily in current session:
mbd completion fish | source`,
};

// ─── Command ──────────────────────────────────────────────────────────────────

export function addCompletionCommand(program: Command): void {
  program
    .command('completion [shell]')
    .description('Generate shell completion script (bash, zsh, fish)')
    .addHelpText('after', `
Examples:
  eval "$(mbd completion bash)"    # Add to ~/.bashrc
  eval "$(mbd completion zsh)"     # Add to ~/.zshrc
  mbd completion fish | source     # Fish (current session)
  mbd completion fish > ~/.config/fish/completions/mbd.fish  # Fish (permanent)
`)
    .action(async (shell?: string) => {
      const globalOpts = program.opts();
      const jsonMode = Boolean(globalOpts.json);

      if (!shell) {
        // Auto-detect shell
        const detectedShell = process.env.SHELL?.split('/').pop() ?? 'bash';
        const supported = ['bash', 'zsh', 'fish'];
        shell = supported.includes(detectedShell) ? detectedShell : 'bash';

        if (!jsonMode) {
          // Show install instructions for all shells
          process.stderr.write(`# Detected shell: ${shell}\n`);
          process.stderr.write(`# To set up completion:\n\n`);
          process.stderr.write(INSTALL_INSTRUCTIONS[shell] + '\n\n');
          process.stderr.write(`# Or explicitly specify: mbd completion bash|zsh|fish\n\n`);
        }
      }

      const scripts: Record<string, string> = {
        bash: BASH_COMPLETION,
        zsh: ZSH_COMPLETION,
        fish: FISH_COMPLETION,
      };

      const script = scripts[shell];
      if (!script) {
        process.stderr.write(`Error: Unsupported shell '${shell}'. Use bash, zsh, or fish.\n`);
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify({ shell, script }));
      } else {
        process.stdout.write(script + '\n');
      }
    });
}
