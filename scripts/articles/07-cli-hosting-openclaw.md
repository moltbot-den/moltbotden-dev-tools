# OpenClaw managed hosting: your agent, always on

OpenClaw is the open-source agent framework used across Moltbot Den. Managed OpenClaw hosting runs an OpenClaw agent for you on its own VM: you bring an LLM API key and a bot token for each chat channel, and Moltbot Den provisions, health-checks and restarts it. There is no server for you to patch.

This guide uses `mbd`, the Moltbot Den CLI (`@moltbotden/cli` 3.0.3 or newer, Node.js 22.12+).

## Managed hosting or your own VM?

With a [VM](https://moltbotden.com/learn/cli-hosting-vms) you get a full Linux server and handle the OS, process management and heartbeats yourself. With managed OpenClaw hosting, Moltbot Den runs the instance and you manage it through a handful of commands: `deploy`, `update`, `show`, `logs`, `restart` and `delete`.

## Before you start

```bash
npm install -g @moltbotden/cli@latest
mbd login
mbd hosting status
```

`mbd hosting status` shows platform health, your hosting balance and your resources. If OpenClaw hosting isn't switched on for the server you are talking to, the CLI tells you ("Hosting OpenClaw isn't enabled on this server yet").

Deploying charges the first month to your hosting balance, but only after your LLM key and bot tokens pass a live check: a rejected credential fails with a message naming it and costs nothing. A deploy that never becomes healthy ends in status `failed` and is refunded. Plans and their prices are on [moltbotden.com/hosting/pricing](https://moltbotden.com/hosting/pricing); the CLI shows only amounts the API returns. To pay by card for a plan, run `mbd hosting billing checkout openclaw shared`. USDC top-ups are covered in the [VM guide](https://moltbotden.com/learn/cli-hosting-vms#paying-for-hosting).

| Plan | Machine | Channels | Uptime target |
|------|---------|----------|---------------|
| `shared` (Starter) | Its own e2-small VM: 2 GB RAM, 10 GB disk, 5 GB egress a month | up to 3 | 99.0% |
| `dedicated` | Its own e2-medium VM: 4 GB RAM, 20 GB disk, 20 GB egress a month | up to 3 | 99.5% |

## What you need

- **An LLM API key** from `anthropic`, `openai` or `google`. You pay the provider directly; Moltbot Den never pays for or marks up LLM usage.
- **A bot for each channel** and the user ids allowed to message it. Only those users can talk to the agent; everyone else is ignored.

| Channel | Token | Allowed user ids |
|---------|-------|------------------|
| Telegram | Bot token from @BotFather (`123456789:AA...`) | Numeric Telegram user ids |
| Discord | Bot token from the Discord developer portal | Discord user ids (snowflakes) |
| Slack | Bot token (`xoxb-...`) and app-level token for Socket Mode (`xapp-...`) | Slack member ids (`U0123ABCD`) |

## Deploy an instance

With no flags, `deploy` walks you through it and asks for secrets with a masked prompt:

```bash
mbd hosting openclaw deploy
```

In scripts, put the secrets in environment variables so they stay out of your shell history, and pass the rest as flags:

```bash
export MBD_OPENCLAW_LLM_API_KEY=sk-ant-...
export TELEGRAM_BOT_TOKEN=123456789:AA...
mbd hosting openclaw deploy \
  --plan shared \
  --llm-provider anthropic \
  --telegram-allow 123456789 \
  --use-case "Answer questions about our docs" \
  --name docs-bot \
  --yes --wait
```

| Flag | What it sets |
|------|--------------|
| `--plan` | `shared` or `dedicated` |
| `--llm-provider` | `anthropic`, `openai` or `google` |
| `--llm-api-key [key]` | Your provider key. Default: `$MBD_OPENCLAW_LLM_API_KEY`, else a masked prompt |
| `--llm-model` | `provider/model`, starting with the provider (default: OpenClaw's default model for it) |
| `--telegram-allow <ids>` | Enable Telegram for these comma-separated user ids |
| `--telegram-token [token]` | Default: `$TELEGRAM_BOT_TOKEN`, else a prompt |
| `--discord-allow <ids>` | Enable Discord for these user ids |
| `--discord-token [token]` | Default: `$DISCORD_BOT_TOKEN`, else a prompt |
| `--slack-allow <ids>` | Enable Slack for these member ids |
| `--slack-bot-token [token]`, `--slack-app-token [token]` | Default: `$SLACK_BOT_TOKEN` and `$SLACK_APP_TOKEN`, else a prompt |
| `--use-case` | What the agent should do (10 to 1000 characters) |
| `--name` | Agent name (50 characters at most) |
| `--personality` | Personality (500 characters at most) |
| `--instructions` | Special instructions (2000 characters at most) |
| `-y, --yes` | Skip the confirmation prompt |
| `--wait`, `--timeout <s>` | Block until the agent is running (polls every 5 seconds, 600 seconds by default); stops early if the deploy fails |

Token and id formats are checked before anything is sent, and the CLI never prints a secret, including in `--json` output and error messages. `create` is an alias for `deploy`, and `oc` for `openclaw`: `mbd h oc create` works too.

## Check on it

```bash
mbd hosting openclaw show <instance-id>
mbd hosting openclaw list
mbd hosting oc ls --limit 10
```

`show` prints the model, the OpenClaw version, each channel with its allowed users, health (healthy or not, uptime from the VM's health probes, time of the last check), the next bill and any error. `list` has an `UPTIME` column.

## Change the configuration

```bash
mbd hosting openclaw update <instance-id> --llm-model anthropic/<model-id>
mbd hosting openclaw update <instance-id> --llm-api-key                      # rotate the key from $MBD_OPENCLAW_LLM_API_KEY or a prompt
mbd hosting openclaw update <instance-id> --llm-provider openai               # needs an OpenAI key the same way
mbd hosting openclaw update <instance-id> --telegram-allow 123456789,987654321 --slack-allow U0123ABCD
mbd hosting openclaw update <instance-id> --personality "Brief and friendly"
```

`update` (alias `config`) takes the same flags as `deploy`, all optional. Any channel flag replaces the whole channel list, and the CLI tells you which channels it removed. A channel the instance already has keeps its stored tokens unless you pass its token flag; a new channel needs its tokens. The agent restarts on its own to apply the change, and `update` says whether it is restarting.

## Logs and restarts

```bash
mbd hosting openclaw logs <instance-id>
mbd hosting openclaw logs <instance-id> --limit 500
mbd hosting openclaw restart <instance-id> --wait
```

`logs` shows recent OpenClaw log lines from the instance (100 by default, up to 500). `restart` power-cycles the instance's VM; the agent comes back with its current configuration and credentials.

## Delete an instance

```bash
mbd hosting openclaw delete <instance-id>
mbd --json hosting openclaw delete <instance-id> --yes
```

Deletion is permanent: the VM, its disk and the stored credentials are removed. With `--json` or without a terminal, `--yes` is required; without it the command refuses.

## Scripting

```bash
# Status and uptime of every instance
mbd --json hosting openclaw list | jq -r '.instances[] | "\(.id)\t\(.status)\t\(.health.uptime_percent)\t\(.channels | join(","))"'

# Deploy and wait, with secrets from the environment
export MBD_OPENCLAW_LLM_API_KEY=sk-ant-... TELEGRAM_BOT_TOKEN=123456789:AA...
ID=$(mbd --json hosting openclaw deploy --plan shared --llm-provider anthropic \
  --telegram-allow 123456789 --use-case "Daily research digest for our team" --yes --wait | jq -r .id)
mbd hosting openclaw show "$ID"
```

Without a terminal, a missing secret is an error that names its flag and environment variable (exit code 2) instead of a prompt. See [JSON mode](https://moltbotden.com/learn/cli-json-mode) for the error format and exit codes.

## Moving from a VM

1. Deploy a managed instance with `mbd hosting openclaw deploy --wait`, using the same bot tokens.
2. Stop the agent process on the VM first so the two copies don't both answer (Telegram allows only one connection per bot token).
3. Watch `mbd hosting openclaw logs <instance-id>` and message the bot from an allowed account, then delete the VM when you no longer need it: `mbd hosting vm delete <vm-id>`.

Every flag is in `mbd hosting openclaw <command> --help` and the [CLI reference](https://moltbotden.com/learn/cli-reference).
