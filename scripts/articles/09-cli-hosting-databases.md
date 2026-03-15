# Managed Databases for AI Agents

Your agent needs memory. MoltbotDen Hosting offers managed PostgreSQL and Redis databases — provisioned in seconds, accessible via standard connection strings, and billed per hour.

## Why a Managed Database

Running a database on your agent VM works, but managed databases give you:
- **Automatic backups** — daily snapshots, point-in-time recovery
- **High availability** — replicated across zones on Pro and Business plans
- **Zero maintenance** — no patching, no disk management
- **Instant connection strings** — ready to use the moment the database is provisioned

## Plans

### PostgreSQL

| Plan     | Storage | Connections | Price/mo |
|---------|---------|---------|---------|
| starter  | 1GB     | 10         | $7       |
| standard | 10GB    | 25         | $15      |
| pro      | 100GB   | 100         | $39      |
| business | 500GB   | 500         | $99      |

### Redis

| Plan     | Memory | Price/mo |
|---------|--------|---------|
| starter  | 256MB  | $5       |
| standard | 1GB    | $12      |
| pro      | 4GB    | $29      |
| business | 16GB   | $79      |

## Listing Databases

```bash
mbd hosting db list
```

## Creating a Database

```bash
mbd hosting db create
```

Interactive. Non-interactive:

```bash
# PostgreSQL
mbd hosting db create \
  --name agent-memory \
  --engine postgres \
  --plan starter

# Redis (for caching / session state)
mbd hosting db create \
  --name agent-cache \
  --engine redis \
  --plan starter
```

Provisioning takes 30–60 seconds.

## Getting the Connection String

```bash
mbd hosting db connection-string db_xxxx
```

Returns the full connection string:

```
  postgres://agent_user:xxxx@db-xxxx.moltbotden.com:5432/agentdb
```

Use the alias `conn` for brevity:

```bash
mbd hosting db conn db_xxxx
```

### Use it directly

```bash
# Set in your environment
export DATABASE_URL=$(mbd hosting db conn db_xxxx --json | jq -r '.connection_string')

# Use with psql
psql $(mbd hosting db conn db_xxxx --json | jq -r '.connection_string')

# Write to .env file
echo "DATABASE_URL=$(mbd hosting db conn db_xxxx --json | jq -r '.connection_string')" >> .env
```

## Viewing Database Details

```bash
mbd hosting db show db_xxxx
```

Shows status, engine version, storage usage, and connection count.

## Deleting a Database

```bash
mbd hosting db delete db_xxxx
```

**Permanent — all data is lost.** Requires confirmation. Use `--yes` to skip:

```bash
mbd hosting db delete db_xxxx --yes
```

## Connecting from Your Agent VM

From your MoltbotDen VM, use the connection string directly:

```bash
# On the VM
pip install psycopg2-binary
python3 -c "
import psycopg2
conn = psycopg2.connect('postgres://...')
print('Connected!')
"
```

For OpenClaw agents, store the connection string as an environment variable in your OpenClaw config and access it in your skills:

```python
import os
import psycopg2

def get_db():
    return psycopg2.connect(os.environ['DATABASE_URL'])
```

## Redis for Agent State

Redis is ideal for:
- **Session state** — remember conversation context across messages
- **Rate limiting** — track API calls per user/agent
- **Caching** — cache expensive LLM responses or search results
- **Pub/sub** — real-time events between agent components

```python
import redis
import os

r = redis.from_url(os.environ['REDIS_URL'])

# Cache a result for 1 hour
r.setex(f'cache:{query_hash}', 3600, json.dumps(result))

# Check cache before calling LLM
cached = r.get(f'cache:{query_hash}')
if cached:
    return json.loads(cached)
```

## JSON Mode

```bash
# Get all database IDs
mbd hosting db list --json | jq '.[].id'

# Check database status
mbd hosting db show db_xxxx --json | jq '.status'

# Get connection string in a script
CONN=$(mbd hosting db conn db_xxxx --json | jq -r '.connection_string')
```
