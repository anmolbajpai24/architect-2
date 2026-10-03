# Deploying Architect 2.0

Architect runs as a single Next.js app. Nothing else is required: no queue, no worker, no sandbox. What it can talk
to — Postgres, Supabase Auth (Google sign-in), a model provider and GitHub — is all optional locally; a public
deployment needs the first three, and GitHub only for "Ship to GitHub".

| | Database | Sign-in | Agents + proposer | Setup |
| --- | --- | --- | --- | --- |
| Local demo | in-process PGlite | off (no accounts) | recorded fixtures | none |
| Local, live models | in-process PGlite | off, or Supabase Auth | Anthropic | an API key |
| Production | Supabase Postgres | Google via Supabase Auth | Anthropic | Supabase + Google OAuth + Vercel + an API key |

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
database that is created, migrated and seeded on first use, and thrown away when the server stops. There are no
accounts: every project is reachable.

`/` lists the reference Laptop Advisor project; open it to run the key demo. Creating a project from a brief needs a
connected model (there is no recorded plan for a brief nobody has written yet), and a generated project's agents
only run in live mode, because only the reference project has recorded fixture behavior.

The headless checks run the same way:

```bash
pnpm scenarios:run          # every scenario against the current agent versions
pnpm scenarios:regress      # the key demo end to end; non-zero exit if any step deviates
pnpm ship:check             # shipping against an in-memory fake GitHub; never calls the real one
pnpm example:auth-check     # reference example: public to view, sign-in to change; generated projects owner-only
pnpm ship:auth-check        # who may ship a change (owner / signed-in on the example / nobody else)
pnpm revisions:auth-check   # who may discard a rule-change draft
pnpm typecheck
```

`ship:check` and `scenarios:*` read `.env.local`: if it sets `DATABASE_URL`, they run against that database, and
`ship:check`, `scenarios:regress` and `scenarios:run --reset` reset the demo project in it. Run them with
`DATABASE_URL=` (empty) in the environment to stay on PGlite. The three
`*:auth-check` scripts blank every credential themselves and refuse any network call except the fake GitHub.

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

Supabase is the Postgres server and, when `SUPABASE_URL` / `SUPABASE_ANON_KEY` are set, the Google sign-in provider
(§6a, through `@supabase/ssr` on the server). Storage and Realtime are not used, and the data is not accessed
through Supabase's client APIs or row-level security: authorization happens in the app (`src/server/access.ts`).

## 4. Environment variables

Server-side only. Never prefix one with `NEXT_PUBLIC_`.

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | production | Postgres connection string. Unset = in-process PGlite (local only). |
| `SUPABASE_URL` | production | Supabase project URL, for Google sign-in (§6a). Unset (with the key) = no accounts. |
| `SUPABASE_ANON_KEY` | production | Supabase anon key. Held server-side only; never sent to the browser. |
| `ARCHITECT_PUBLIC_URL` | production | This deployment's origin. The OAuth redirect base, and the links a shipped PR carries back to the change and to the running project (`/preview/<projectId>`). |
| `ANTHROPIC_API_KEY` | for live modes | Default provider for agents, proposer, planner and judge. |
| `OPENAI_API_KEY` | optional | Only for a model configured with an `openai:` prefix. |
| `ARCHITECT_MODEL_MODE` | `live` in production | `fixture` (default) or `live` agent runtime. `live` also turns the judge on. Generated projects need `live`. |
| `ARCHITECT_PROPOSER` | `live` in production | Change, rule-change and project-planning model: `live` or `fixture`. Unset = live when the model's key is present. |
| `ARCHITECT_JUDGE` | optional | `live` to score judge assertions without putting agents on live models. |
| `ARCHITECT_PROPOSER_MODEL` | optional | Default `anthropic:claude-opus-5-5`. |
| `JUDGE_MODEL` | optional | Default `anthropic:claude-opus-5-5`. |
| `ARCHITECT_GITHUB_TOKEN` | optional | Server-wide shipping credential; see §7. |
| `ARCHITECT_GITHUB_REPOS` | optional | `owner/name` allowlist, comma separated. |
| `ARCHITECT_GITHUB_API_URL` | optional | GitHub Enterprise Server API base. |
| `ARCHITECT_PROJECT` | no | The code-defined project a request without `?project=` opens. Default `laptop-advisor`. |
| `ARCHITECT_ALLOW_EPHEMERAL_DB` | no | Accepts a deployment with no `DATABASE_URL`. See the warning below. |

`VERCEL` is set by the platform, not by you: it is how Architect knows it is on a managed host.

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
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-key>
ARCHITECT_PUBLIC_URL=https://<your-deployment>
ANTHROPIC_API_KEY=sk-ant-...
ARCHITECT_MODEL_MODE=live
ARCHITECT_PROPOSER=live
# optional, for "Ship to GitHub" (§7)
ARCHITECT_GITHUB_TOKEN=github_pat_...
ARCHITECT_GITHUB_REPOS=<owner>/<demo-repository>
```

Don't deploy publicly with live keys and sign-in off: without `SUPABASE_URL` / `SUPABASE_ANON_KEY` there are no
accounts, so every project — and every model call and pull request it can trigger — is open to anyone.

Then deploy and open `/api/health`:

```json
{ "ok": true, "deployment": "managed", "database": { "connected": true, "kind": "postgres", "persistent": true },
  "agents": { "mode": "live", "configured": true }, "problems": [] }
```

`ok: false` lists what is wrong in `problems` — statuses and variable names only, never a value. The workspace's
Environment panel shows the same problems to the person using it.

The deployed app opens on a home page: the reference Laptop Advisor project under "Examples", the viewer's own
projects under "Your projects", and a brief box to create a new one (signed in). Laptop Advisor is demo data, not
platform structure: agents, tools, scenarios and their assertions are rows, and only `src/seed/` and `src/demo/`
know about laptops. Each project's workspace is `/workspace?project=<id>`; its running agents are at
`/preview/<projectId>`.

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

## 6a. Sign in with Google (optional)

Unset, the app runs exactly as it always has: no accounts, no viewer, every project reachable, deterministic demo
unaffected. Set, projects belong to the Google account that created them.

Sign-in uses **Supabase Auth on the same Supabase project as `DATABASE_URL`** — no second provider, and no user
table of Architect's own. A project row stores the Supabase user id in `projects.owner_id`; that is the entire
identity model.

1. **Google Cloud console** → APIs & Services → Credentials → *OAuth client ID* (Web application).
   Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase's, not yours).
2. **Supabase** → Authentication → Providers → Google: paste the client ID and secret, enable.
3. **Supabase** → Authentication → URL Configuration:
   - Site URL: your deployed origin.
   - Redirect URLs: `https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback`.
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project settings → API), and `ARCHITECT_PUBLIC_URL` to your
   deployed origin — the OAuth redirect is built from it, so a proxy header can't rewrite where Google returns to.

Routes: `/auth/signin` starts the flow, `/auth/callback` exchanges the one-time code for a session, `/auth/signout`
ends it. `src/middleware.ts` refreshes the access token on every request, because a Server Component can read
cookies but not write them. Nothing is `NEXT_PUBLIC_`: the Supabase client only ever runs on the server.

**Who can do what.** There are two kinds of project, and one check (`assertProjectAccess` in
`src/server/access.ts`) that every route and page goes through — the home page listing is a convenience, not the
control. A project whose slug names a definition in code (Laptop Advisor) is the public **reference example**;
anything else was **generated from a brief** and belongs to the Google account that created it. Each request opens
its project either to **view** it or to **change** it:

| With sign-in configured | View (workspace, agents, scenarios, activity stream, preview page) | Change (propose, fix, apply, rule changes, run, preview chat, ship; reset, which only the example has) |
| --- | --- | --- |
| Reference example, signed out | allowed | **401** "Anyone can explore the demo. Sign in with Google to change or ship it." |
| Reference example, any signed-in user | allowed | allowed |
| Generated project, its owner | allowed | allowed |
| Generated project, anyone else (signed in or not) | **403** | **403** |

"Change" covers everything that mutates a project, spends a model call or reaches GitHub — which is why one preview
chat turn needs sign-in on the example while the preview page itself does not. Creating a project
(`POST /api/projects`) and planning one (`POST /api/projects/plan`) need a signed-in user (401 otherwise). The
check runs before any write, job, model call or GitHub call, and a change or rule-change draft is always resolved
to its own project first, so knowing an id is never enough. The workspace header offers "Sign in with Google" to a
signed-out visitor and returns them to the same workspace.

Without sign-in configured, all of the above is allowed for everyone, as it was before accounts existed.

The reference example is one shared project: every signed-in user changes, resets and ships the same one (§8).

A generated project with no owner predates sign-in: once sign-in is configured it is listed nowhere and opens for
no one. To adopt one, set its owner directly:

```sql
update projects set owner_id = '<supabase-user-id>' where slug = '<slug>';
```

## 7. GitHub shipping (optional)

Everything except the "Ship to GitHub" button works without this.

1. Create a fine-grained personal access token limited to the repositories you want to ship to, with
   **Contents: Read and write** and **Pull requests: Read and write**.
2. Set `ARCHITECT_GITHUB_TOKEN` and `ARCHITECT_GITHUB_REPOS=owner/name[,owner/name]`. Each repository needs at
   least one commit on its default branch.
3. Set `ARCHITECT_PUBLIC_URL` so the pull request can link back to `…/?change=<id>`.

The token stays on the server: the browser only learns whether GitHub is configured and which repositories are
allowed. A change can only ship after Architect has verified it (`src/shipping/gate.ts`), and shipping opens a pull
request — it never pushes to the default branch.

**Who may ship.** The ship route authorizes against the change's project before it takes the job lock, claims the
shipment or calls GitHub: the owner for a generated project, any signed-in user for the reference example, nobody
else (§6a). Then the verification gate applies.

**One credential, one allowlist.** The prototype has a single server-wide token and repository allowlist, set up
around the demo repository: every user who may ship ships to those same repositories, under that one identity.
There is no per-user GitHub connection. Production replaces this with a GitHub App that each user installs on the
repositories they choose, and a short-lived installation token per ship (`docs/architecture.md`).

**What the pull request is.** The commit holds the verified agent and scenario definitions and the change's
verification record as JSON under `architect/` — not application code. With `ARCHITECT_PUBLIC_URL` set, the PR
links back to the change and to the running project. Merging it deploys nothing: the change went live when it was
applied in Architect, which is the runtime.

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
- **Accounts are ownership, nothing more.** Google sign-in (Supabase Auth) plus one `owner_id` per project: no
  teams, roles, sharing or invitations, and no admin. Authorization is enforced in the app's access layer, not by
  database row-level security. Without the Supabase variables there are no accounts at all and everything is open.
- **The reference example is shared.** It is one project for the whole deployment: any signed-in user can change,
  reset and ship it, so visitors see and overwrite each other's work on it. Generated projects are isolated per
  owner; the example is not copied per visitor.
- **No quotas or rate limits.** Every model call runs on the server's one provider key. Sign-in is the only gate on
  spend: a signed-in user can plan projects, run scenarios and chat with agents without limit. Production wants
  per-user budgets and rate limiting at the edge.
- **Agent execution is in-process.** Agents are LLM calls from the server; the registered tool (`search_catalog`)
  reads the seeded catalog from the same database. A generated project has agents and scenarios but no tools of
  its own and no generated code, and it only runs on live models (no recorded fixture behavior). There is no
  sandbox — E2B, generated application code and running a user's own app are not built.
- **Preview is not a deployment.** `/preview/<projectId>` runs a project's live agent versions in the Architect
  server process, on the same deployment; applying a change is what makes it live. There is no per-project host,
  build, artifact or environment. A shipped pull request holds the verified definitions as JSON (an honest
  representation of what Architect actually has), and merging it deploys nothing. `docs/architecture.md` describes
  the gateway, sandbox and deployment workers a production system would add; none of that is built.
- **GitHub auth is one personal access token.** A single server-wide token and repository allowlist, configured
  around the demo repository and shared by every user who may ship. Production wants a GitHub App that each user
  installs on their own repositories, with a short-lived installation token per ship. The provider already takes a
  token supplier, so this is a swap, not a rewrite; the per-user installation flow is not built.
- **Migrations run on cold start.** Convenient, but concurrent cold starts can race (see §5).
