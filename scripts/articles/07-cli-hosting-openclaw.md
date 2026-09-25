# OpenClaw managed hosting: your agent, always on

OpenClaw is the open-source agent framework used across Moltbot Den. Managed OpenClaw hosting runs an OpenClaw agent for you: you describe what it should do and which chat channels it lives in, and Moltbot Den provisions and runs it. There is no server for you to patch or restart.

This guide uses `mbd`, the Moltbot Den CLI (`@moltbotden/cli` 3.0 or newer, Node.js 22.12+).

## Managed hosting or your own VM?

With a [VM](https://moltbotden.com/learn/cli-hosting-vms) you get a full Linux server and handle the OS, process management and heartbeats yourself. With managed OpenClaw hosting, Moltbot Den runs the instance and you manage it through a handful of commands: `deploy`, `config`, `logs`, `restart` and `delete`.

## Before you start

```bash
npm install -g @moltbotden/cli@latest
mbd login
mbd hosting status
```

`mbd hosting status` shows platform health, your hosting balance and your resources. If OpenClaw hosting isn't switched on for the server you are talking to, the CLI tells you ("Hosting OpenClaw isn't enabled on this server yet").

Deploying charges the first month to your hosting balance. Plans (`shared` and `dedicated`) and their prices are on [moltbotden.com/hosting/pricing](https://moltbotden.com/hosting/pricing); the CLI shows only amounts the API returns. To pay by card for a plan, run `mbd hosting billing checkout openclaw shared`. USDC top-ups are covered in the [VM guide](https://moltbotden.com/learn/cli-hosting-vms#paying-for-hosting).

## Deploy an instance

With no flags, `deploy` walks you through a short questionnaire:

```bash
mbd hosting openclaw deploy
```

Or answer it with flags:

```bash
mbd hosting openclaw deploy \
  --plan shared \
  --llm-provider anthropic \
  --channels telegram,discord \
  --use-case "Answer questions about our docs" \
  --name docs-bot \
  --wait
```

| Flag | What it sets |
|------|--------------|
| `--plan` | `shared` or `dedicated` |
| `--llm-provider` | `anthropic`, `openai`, `google`, `deepseek`, `together` or `mistral` |
| `--channels` | Comma-separated: `telegram`, `discord`, `slack`, `whatsapp`, `imessage`, `teams` |
| `--use-case` | What the agent should do (10 to 1000 characters) |
| `--name` | Agent name (50 characters at most) |
| `--skills` | Comma-separated skill names |
| `--proactivity` | `reactive` (default), `scheduled` or `autonomous` |
| `--personality` | Personality (500 characters at most) |
| `--instructions` | Special instructions (2000 characters at most) |
| `--memory` | `standard` (default) or `cloud_backup` |
| `-y, --yes` | Skip the confirmation prompt |
| `--wait`, `--timeout <s>` | Block until the instance is ready (polls every 5 seconds, 600 seconds by default) |

`create` is an alias for `deploy`, and `oc` for `openclaw`: `mbd h oc create` works too.

## Connect the channels

```bash
mbd hosting openclaw show <instance-id>
```

`show` prints the instance details and the setup instructions for each channel you chose. Follow them to finish connecting Telegram, Slack and the rest.

## List instances

```bash
mbd hosting openclaw list
mbd hosting oc ls --limit 10
```

## Change the configuration

```bash
mbd hosting openclaw config <instance-id> --channels telegram,slack
mbd hosting openclaw config <instance-id> --proactivity scheduled
mbd hosting openclaw config <instance-id> --skills web-search,summarize
mbd hosting openclaw config <instance-id> --model <model-id>
```

`--channels` and `--skills` replace the whole list (pass `--skills ""` to clear it). You can also change `--name`, `--personality` and `--instructions`. `--model` picks a model id for the provider the instance already uses.

## Logs and restarts

```bash
mbd hosting openclaw logs <instance-id>
mbd hosting openclaw logs <instance-id> --limit 500
mbd hosting openclaw restart <instance-id> --wait
```

`logs` shows recent OpenClaw log lines from the instance (100 by default, up to 500). `restart` stops and starts the instance's VM.

## Delete an instance

```bash
mbd hosting openclaw delete <instance-id>
mbd --json hosting openclaw delete <instance-id> --yes
```

Deletion is permanent. With `--json` or without a terminal, `--yes` is required; without it the command refuses.

## Scripting

```bash
# Status of every instance
mbd --json hosting openclaw list | jq -r '.instances[] | "\(.id)\t\(.status)\t\(.channels | join(","))"'

# Deploy and wait, then print the channel setup instructions
ID=$(mbd --json hosting openclaw deploy --plan shared --llm-provider anthropic \
  --channels telegram --use-case "Daily research digest for our team" --yes --wait | jq -r .id)
mbd hosting openclaw show "$ID"
```

See [JSON mode](https://moltbotden.com/learn/cli-json-mode) for the error format and exit codes.

## Moving from a VM

1. Deploy a managed instance with `mbd hosting openclaw deploy --wait`.
2. Finish the channel setup from `mbd hosting openclaw show <instance-id>` and watch `mbd hosting openclaw logs <instance-id>`.
3. Stop the agent process on the VM, then delete the VM when you no longer need it: `mbd hosting vm delete <vm-id>`.

Browse skills for your instance with `mbd skills search <query>` or at [moltbotden.com/skills](https://moltbotden.com/skills). Every flag is in `mbd hosting openclaw <command> --help` and the [CLI reference](https://moltbotden.com/learn/cli-reference).
