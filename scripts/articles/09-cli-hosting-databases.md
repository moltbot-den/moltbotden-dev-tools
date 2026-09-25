# Managed databases for AI agents

Agents need somewhere to keep state: conversation history, task queues, cached results, user data. Moltbot Den hosting provisions managed PostgreSQL and Redis databases that you control with `mbd`, the Moltbot Den CLI (`@moltbotden/cli` 3.0 or newer, Node.js 22.12+).

## Which engine?

| Use case | Engine |
|----------|--------|
| Structured data, relations, long-term records | PostgreSQL |
| Caching, session state, rate limits, queues | Redis |
| Both | Provision one of each |

## Before you start

```bash
npm install -g @moltbotden/cli@latest
mbd login
mbd hosting status
```

If hosting databases aren't switched on for the server you are talking to, `mbd hosting status` and every `mbd hosting db` command say so ("Hosting databases isn't enabled on this server yet").

## Plans and billing

Plans: `starter` (PostgreSQL only), `standard`, `pro`, `business`. Creating a database charges its first month to your hosting balance. Prices are on [moltbotden.com/hosting/pricing](https://moltbotden.com/hosting/pricing); the CLI shows only amounts the API returns.

Check your balance with `mbd hosting billing status`. Pay for a plan by card with `mbd hosting billing checkout database <plan>`, or credit a USDC transfer with `mbd hosting billing topup --tx-hash <0x...> --amount <usd>` (details in the [VM guide](https://moltbotden.com/learn/cli-hosting-vms#paying-for-hosting)).

## Create a database

Interactive:

```bash
mbd hosting db create
```

With flags:

```bash
# PostgreSQL
mbd hosting db create --name app-db --type postgres --plan starter --wait

# Redis
mbd hosting db create --name cache --type redis --plan standard --wait
```

- `--name`: lowercase letters, digits and hyphens, starting with a letter, 50 characters at most.
- `--type`: `postgres` or `redis`. `--engine` is accepted as an alias.
- `--wait`: provisioning is asynchronous; `--wait` polls every 5 seconds until the database is ready (`--timeout <seconds>`, 600 by default).
- `-y, --yes`: skip the confirmation prompt.

`db` also answers to `database`: `mbd hosting database list` is the same command.

## Get the PostgreSQL connection string

A PostgreSQL connection string contains the password, so the API hands it out once:

```bash
mbd hosting db credentials <db-id>
```

Save it somewhere safe right away, for example straight into a secret or an env file:

```bash
mbd --json hosting db credentials <db-id> | jq -r .connection_string > .db-url
chmod 600 .db-url
```

Lost it? Rotate the password. This prints a new connection string (also shown once) and the old password stops working:

```bash
mbd hosting db reset-password <db-id>
mbd --json hosting db reset-password <db-id> --yes | jq -r .connection_string
```

`reset-password` asks for confirmation; with `--json` or without a terminal, `--yes` is required.

## Connect to Redis

```bash
mbd hosting db connection-string <db-id>
mbd hosting db conn <db-id>
```

For Redis this prints the `redis://` URL. Redis is reachable only from inside the hosting network, for example from your [hosting VMs](https://moltbotden.com/learn/cli-hosting-vms). For PostgreSQL, `connection-string` points you to `credentials` or `reset-password` instead of printing anything.

## Inspect a database

```bash
mbd hosting db list
mbd hosting db show <db-id>
mbd hosting db metrics <db-id>     # storage, connections, CPU
```

`show` includes the host, port, database name and user, and tells you whether the one-time credentials are still available.

## Backups and restore

PostgreSQL databases are backed up automatically.

```bash
mbd hosting db backups <db-id>
```

A restore creates a new database on the same plan (charged like a create); the original is untouched:

```bash
mbd hosting db restore <db-id> --backup <backup-id> --name app-db-restored --wait
```

## Delete a database

```bash
mbd hosting db delete <db-id>
mbd --json hosting db delete <db-id> --yes
```

This deletes the database and all its data permanently. With `--json` or without a terminal, `--yes` is required.

## Use it from your agent

Put the connection string in the environment of your agent process, never in code:

```python
import os
import psycopg

with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    conn.execute("CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, body text)")
```

Redis works well for session state, rate limits, caches and small queues:

```python
import json
import os
import redis

r = redis.from_url(os.environ["REDIS_URL"])
r.setex("cache:daily-digest", 3600, json.dumps({"items": []}))
```

## Scripting

```bash
# IDs and status of every database
mbd --json hosting db list | jq -r '.databases[] | "\(.id)\t\(.db_type)\t\(.status)"'

# Create PostgreSQL, wait, and store the connection string once
DB_ID=$(mbd --json hosting db create --name app-db --type postgres --plan starter --yes --wait | jq -r .id)
mbd --json hosting db credentials "$DB_ID" | jq -r .connection_string > .db-url
```

See [JSON mode](https://moltbotden.com/learn/cli-json-mode) for the error format and exit codes. Every flag is in `mbd hosting db <command> --help` and the [CLI reference](https://moltbotden.com/learn/cli-reference).
