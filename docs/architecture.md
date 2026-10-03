# Architect 2.0: architecture

Architect turns user intent into persistent **Scenarios** and verifies every **Change** to the agent system against
them before it can go live, and before it can ship.

```
request → Change (new immutable AgentVersions) → structural check → behavioral run (every scenario)
        → blocked: Keep the rule → Fix it   |   Change the rule → new Scenario version, re-verify
        → verified → apply (live) → scenarios re-run on the live agents → Ship to GitHub (pull request)
```

One Next.js app (App Router): route handlers for actions, Server-Sent Events for live progress, Postgres (Supabase,
or in-process PGlite locally) through Drizzle. Agents run on the Vercel AI SDK. Details of each part live in `CLAUDE.md`.

## Shipping to GitHub

**Invariant: a Change cannot be shipped until Architect has verified its behavior.** The server enforces this in
`src/shipping/gate.ts` for every ship request; the UI only reflects the same gate. A change ships only when:

- it is **applied**, with passing structural verification and a passing behavioral run on record;
- the live agents are exactly the version set that run verified (a later change hasn't replaced them);
- scenarios have re-run on the live agents since it was applied, and **every current scenario version passes** there
  (so no failed scenario, including a rule changed after the fact, is left unresolved).

Shipping (`src/shipping/ship.ts`) then makes branch `architect/change-<change-id>` from the repository's default
branch, one commit, and a pull request whose body states the verification result. Provenance (repository, branch,
commit SHA, PR number and URL, timestamps, the verifying run) is stored in `change_shipments`, one row per change.
That row is also the claim that makes shipping idempotent: a double click can't open two PRs, a shipped change
returns its recorded PR, and a retry after a failure reuses the branch, skips an identical commit and reuses an
existing PR. Failures are recorded as `change.ship_failed` events.

**What the commit contains (prototype representation).** Architect doesn't generate application code yet, so it
doesn't pretend to: the commit is the verified agent system itself, as machine-readable files under `architect/`:
each agent's live AgentVersion, the scenarios it was verified against, and a record of the change and its
verification runs. The PR and the UI both say so.

### Prototype

```
Browser ──(ship request, no credentials)──▶ Next.js server ──(server-side token)──▶ GitHub REST API ──▶ repository
```

- One server-side credential from the environment: `ARCHITECT_GITHUB_TOKEN`, a fine-grained token limited to the
  repositories in `ARCHITECT_GITHUB_REPOS` (Contents and Pull requests: read and write). The user picks a
  repository from that allowlist; the server rejects anything else.
- All GitHub calls go through one narrow provider (`src/github/provider.ts`: get repository, get/create branch,
  commit files, find/create pull request) over `fetch`. Nothing else in the codebase talks to GitHub.

### Production

```
Browser ──▶ Next.js server ──(App private key → JWT)──▶ GitHub App ──▶ short-lived installation token ──▶ repository
```

- Users install an Architect **GitHub App** on the repositories they choose. That installation, not a pasted token,
  is the "connect a repository" step, and it defines what Architect can reach.
- For each ship, the server signs a JWT with the App's private key and exchanges it for an **installation access
  token**: it expires after an hour and is restricted to that installation's repositories and the App's
  permissions (Contents, Pull requests). Nothing long-lived ever reaches a user's machine.
- The provider already takes a token supplier, so this replaces the environment token without changing the
  shipping flow.

### Why the credential is server-side and scoped

- **It never leaves the server.** It isn't sent to the browser (the workspace only learns whether GitHub is
  configured and which repositories are allowed), and it isn't in agent prompts, the scenario runtime, events,
  stored provenance or committed files. Agents never get a GitHub tool.
- **It is opt-in and narrow.** Architect-prefixed variables avoid picking up an ambient `GITHUB_TOKEN` by accident;
  the token is limited to specific repositories and two permissions, and shipping only opens a pull request. It
  never pushes to the default branch, so a human still reviews and merges.
- **Short-lived in production.** Installation tokens expire within the hour and are scoped per installation, so a
  leak is bounded in time and reach.
