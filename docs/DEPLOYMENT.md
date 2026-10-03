# Deploying Architect 2.0

Architect runs as a single Next.js app. Nothing else is required: no queue, no worker, no sandbox. The two things
it can talk to — Postgres and a model provider — are both optional locally and both expected in production.

| | Database | Agents + proposer | Setup |
| --- | --- | --- | --- |
| Local demo | in-process PGlite | recorded fixtures | none |
| Local, live models | in-process PGlite | Anthropic | an API key |
| Production | Supabase Postgres | Anthropic | Supabase + Vercel + an API key |

Every setting is read on the server, in `src/server/env.ts`. No variable is exposed to the browser: the client is
given only the derived statuses in `WorkspaceSnapshot["env"]` (which mode, which model name, which repositories),
never a key. Check any running instance with `GET /api/health`.

## 1. Local, offline demo

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

No credentials, no database, no network. Agents run on the deterministic fixture model, the proposer replays the
recorded edits for the scripted demo request, and judge checks report as skipped. Storage is an in-process PGlite
database that is created, migrated and seeded on first use, and thrown away when the server stops.

The headless checks run the same way:

```bash
pnpm scenarios:run        # every scenario against the current agent versions
pnpm scenarios:regress    # the key demo end to end; non-zero exit if any step deviates
pnpm ship:check           # shipping against an in-memory fake GitHub; never calls the real one
pnpm typecheck
```

## 2. Local, real models

Copy `.env.example` to `.env.local` (gitignored) and set:

```
ANTHROPIC_API_KEY=sk-ant-...
ARCHITECT_MODEL_MODE=live
ARCHITECT_PROPOSER=live
```

`ARCHITECT_MODEL_MODE=live` makes scenarios run the agents on the provider model named in each AgentVersion, and
turns judge assertions on. `ARCHITECT_PROPOSER=live` lets Architect draft any change, not only the scripted one.
Model names come from the agent configurations and from `ARCHITECT_PROPOSER_MODEL` / `JUDGE_MODEL` — never from the
UI, and never from the browser.

Nothing silently degrades. If a live mode is set without the matching key, the workspace says so in its Environment
panel, `/api/health` returns 503 with the reason, and any action that would call the provider is refused with a
message instead of failing halfway through a run.

The same flags work on the scripts: `pnpm scenarios:run --live`, `--judge`.

## 3. Supabase

1. Create a Supabase project. Any region; a free project is enough for the demo.
2. Copy the **pooled** connection string (Connect → Transaction pooler, port 6543) and add the password.
3. Put it in `DATABASE_URL`.

Architect opens it with `postgres.js` and `prepare: false`, which is what the transaction pooler requires, and a
pool of 3 per instance. The schema is the same Drizzle schema PGlite uses — one data model, one set of migrations,
no Supabase-specific SQL. The migrations use only core Postgres (`uuid`, `jsonb`, `timestamptz`, `gen_random_uuid()`,
`serial`), so no extension has to be enabled.

No Supabase client library, Auth, Storage or Realtime is used: Supabase is the Postgres server, nothing more.

## 4. Environment variables

Server-side only. Never prefix one with `NEXT_PUBLIC_`.

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | production | Postgres connection string. Unset = in-process PGlite (local only). |
| `ANTHROPIC_API_KEY` | for live modes | Default provider for agents, proposer and judge. |
| `OPENAI_API_KEY` | optional | Only for a model configured with an `openai:` prefix. |
| `ARCHITECT_MODEL_MODE` | `live` in production | `fixture` (default) or `live` agent runtime. `live` also turns the judge on. |
| `ARCHITECT_PROPOSER` | `live` in production | `live` or `fixture`. Unset = live when the model's key is present. |
| `ARCHITECT_JUDGE` | optional | `live` to score judge assertions without putting agents on live models. |
| `ARCHITECT_PROPOSER_MODEL` | optional | Default `anthropic:claude-opus-5-5`. |
| `JUDGE_MODEL` | optional | Default `anthropic:claude-opus-5-5`. |
| `ARCHITECT_ALLOW_EPHEMERAL_DB` | no | Accepts a deployment with no `DATABASE_URL`. See the warning below. |
| `ARCHITECT_GITHUB_TOKEN` | optional | Shipping credential; see §7. |
| `ARCHITECT_GITHUB_REPOS` | optional | `owner/name` allowlist, comma separated. |
| `ARCHITECT_PUBLIC_URL` | optional | Where this instance is reachable, so a PR can link back to the change. |
| `ARCHITECT_GITHUB_API_URL` | optional | GitHub Enterprise Server API base. |

A deployment with no `DATABASE_URL` is **refused**, with a message saying so. Each serverless instance would
otherwise seed its own throwaway copy of the project, so a change verified by one request could be invisible to
the next. `ARCHITECT_ALLOW_EPHEMERAL_DB=1` accepts that trade for a throwaway preview; `/api/health` keeps
reporting it as a problem.

## 5. Migrations

Migrations live in `drizzle/` and are generated from `src/db/schema.ts`:

```bash
pnpm db:generate     # after changing the schema
pnpm db:migrate      # apply to DATABASE_URL (Supabase, or any Postgres)
```

The server also applies pending migrations when it opens the database, so a deploy with a new migration is applied
by the first cold start. Prefer running `pnpm db:migrate` yourself before shipping a schema change: several
instances cold-starting at once would otherwise race on the migration, and the loser's request fails rather than
waiting. The migration files are included in the Vercel function bundle automatically (they are part of the traced
file set — verify with `grep -l drizzle/0000_init.sql .next/server/app/**/*.nft.json` after a build).

## 6. Vercel

Import the repository. `vercel.json` pins the framework and a frozen-lockfile install; everything else is Next.js
defaults. Node 22 comes from `engines.node` in `package.json`.

Set in Project Settings → Environment Variables (Production, and Preview if you use it):

```
DATABASE_URL=postgresql://...pooler.supabase.com:6543/postgres
ANTHROPIC_API_KEY=sk-ant-...
ARCHITECT_MODEL_MODE=live
ARCHITECT_PROPOSER=live
ARCHITECT_PUBLIC_URL=https://<your-deployment>
```

Then deploy and open `/api/health`:

```json
{ "ok": true, "deployment": "managed", "database": { "connected": true, "kind": "postgres", "persistent": true },
  "agents": { "mode": "live", "configured": true }, "problems": [] }
```

`ok: false` lists what is wrong in `problems` — statuses and variable names only, never a value. The workspace's
Environment panel shows the same problems to the person using it.

The deployed app opens straight into the seeded Laptop Advisor project, which is demo data, not platform
structure: agents, tools, scenarios and their assertions are rows, and `src/seed/` is the only place that knows
about laptops.

**Function limits.** Every route that can start model work declares `maxDuration = 300`. With fluid compute
(on by default) 300s is Vercel's *default* maximum duration and the ceiling on every plan, Hobby included — Pro
and Enterprise allow up to 800s. The earlier value of 60 was the universal limit before fluid compute and is now
below the platform default, so it only shortened these routes.

Two things run long enough to care. Planning a project from a brief is one model call that writes a whole project
description — around 5,500 output tokens, about a minute on `claude-opus-5-5`. A verification run makes one
provider call per agent per scenario (9 for the seeded project, plus judge calls, and more for a larger generated
one), which is instant in fixture mode and minutes on live models. If either is cut off at the limit the job dies
without recording a result and the run stays unfinished in the UI. Nothing is lost — rerun it.

Active CPU billing pauses while a function waits on I/O, so a route that spends its time waiting on a provider
costs little more at 300s than at 60s. One caveat the platform documents: a request that sends no bytes for
minutes can still be dropped by an HTTP/1.1 client or an intermediary. Planning holds the connection open without
streaming, so a very slow provider could lose the connection before the limit does.

## 7. GitHub shipping (optional)

Everything except the "Ship to GitHub" button works without this.

1. Create a fine-grained personal access token limited to the repositories you want to ship to, with
   **Contents: Read and write** and **Pull requests: Read and write**.
2. Set `ARCHITECT_GITHUB_TOKEN` and `ARCHITECT_GITHUB_REPOS=owner/name[,owner/name]`. Each repository needs at
   least one commit on its default branch.
3. Set `ARCHITECT_PUBLIC_URL` so the pull request can link back to `…/?change=<id>`.

The token stays on the server: the browser only learns whether GitHub is configured and which repositories are
allowed. A change can only ship after Architect has verified it (`src/shipping/gate.ts`), and shipping opens a pull
request — it never pushes to the default branch. See `docs/architecture.md` for the GitHub App design that replaces
the token in production.

## 8. Known prototype limitations

These are deliberate. They are the boundary between what this prototype proves and what a production system needs,
and none of them is hidden behind a mock that pretends to work.

- **Job serialization is process-local.** "One job at a time" is a variable in server memory
  (`src/server/context.ts`). Correct for one server; on several Vercel instances each sees an empty lock, so two
  runs could start at once. Production wants a lease row in Postgres claimed with a conditional update, renewed
  while the job runs, and expiring if the instance dies.
- **Background jobs are `after()` callbacks.** Verification runs inside the invocation that scheduled it, bounded
  by that route's `maxDuration` (see §6). A job killed at the limit leaves its run unfinished and emits no event.
  Production wants a durable worker — a queue, or a scheduled consumer of a jobs table — that survives the request
  and can retry.
- **SSE is a database poll.** `/api/events` polls the events table every 250ms (500ms on Postgres) and closes
  after 50 seconds so the browser reconnects inside the function limit; a `sync` event carries the sequence number
  so nothing is re-delivered. This is deliberately boring — it works identically on PGlite and Supabase and keeps
  the server stateless — but it is one query per client per tick, not a subscription.
- **One project, seeded.** The demo project is created on first use and `POST /api/reset` restores it. There is no
  project creation UI, no auth and no multi-user isolation: anyone who can reach the deployment can change the
  agents. Don't deploy it publicly with a live key and expect it to stay untouched.
- **Agent execution is in-process.** Agents are LLM calls from the server; the registered tool (`search_catalog`)
  reads the seeded catalog from the same database. There is no sandbox — E2B, generated application code and
  running a user's own app are not built.
- **No preview environment for the verified app.** Architect ships the verified agent system as JSON files in a
  pull request (an honest representation of what it actually has), not a deployed application.
- **GitHub auth is a personal access token.** Production wants a GitHub App installation token: short-lived,
  scoped per installation, with repository selection as the connect step. The provider already takes a token
  supplier, so this is a swap, not a rewrite.
- **Migrations run on cold start.** Convenient, but concurrent cold starts can race (see §5).
