# Architect 2.0

**[Live demo](https://architect-20-theta.vercel.app/)**

**Agent systems, with proof.** Architect turns what you ask for into persistent **Scenarios**, and verifies every
change to an agent system against them before the change can go live or ship.

A prototype, built as a take-home assignment. It is one Next.js app, and it runs fully offline with no credentials.

## The thesis

An agent configuration can be perfectly valid and still do the wrong thing. Ask for a "more confident, persuasive"
recommendation agent and you get valid instructions, valid tools, valid handoffs — and an agent that now recommends
a laptop above the customer's budget instead of saying that nothing fits.

Nothing in the configuration catches that. Only behavior does. So Architect keeps two verdicts apart:

- **Configuration**: is the change structurally sound (real agents, registered tools, reachable handoffs)?
- **Behavior**: do the rules the product already promised still hold?

The rules are **Scenarios**: an input plus checks on what the agents did (`tool`), what they returned (`output`), or
what a model judges about the answer (`judge`). They persist, they are versioned, and every change runs against all
of them. Deterministic checks decide pass or fail wherever they can; a model judge covers only what they cannot.

## The loop

```
request → Change (new immutable agent versions) → structural check → behavioral run (every scenario)
        → blocked:  Keep the rule → Fix it      (the agent is wrong: Architect drafts a fix, re-verified)
                    Change the rule             (the requirement changed: a new scenario version, re-verified)
        → verified → apply (live) → scenarios re-run on the live agents → Ship to GitHub (pull request)
```

A failed change never reaches the live agents: an agent's current version only moves when a verified change is
applied. When a change is blocked, Architect leads with what the customer would have heard, shows expected against
actual, and makes the fork explicit instead of quietly "fixing" either side.

## Try it in two minutes

Requires Node 22.5+ and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

No keys, no database, no network: an in-process Postgres (PGlite) and recorded fixture models make the demo
reproduce exactly.

1. Open **Laptop Advisor** under Examples and press **Run scenarios**. All three pass.
2. Ask for the suggested change: *"Make the Recommendation Agent more confident and persuasive. Customers hate
   hearing no."*
3. Configuration stays valid. A scenario fails: the agent recommends above the customer's budget.
4. Choose **Keep the rule → Fix it**. Architect drafts a fix; every scenario passes again.
5. Apply it. The change is live at once in **Preview**, where you can talk to the agents.

The same flow, headless:

```bash
pnpm scenarios:regress      # the key demo end to end; non-zero exit if any step deviates
pnpm ship:check             # the ship gate and branch → commit → PR, against an in-memory fake GitHub
pnpm example:auth-check     # the access rules, through the real route handlers
pnpm typecheck
```

To use real models, create projects from your own brief, sign in with Google, or ship to GitHub, copy
[`.env.example`](.env.example) to `.env.local` and follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## What is built, and what is designed

The prototype says what it is. Nothing below the line is mocked to look finished.

| | Prototype (implemented) | Production (designed in [`docs/architecture.md`](docs/architecture.md), not built) |
| --- | --- | --- |
| **Verification** | Structural check, then every scenario, on immutable agent and scenario versions. Fix the agent or change the rule; both are re-verified. | The same engine. |
| **Projects** | A seeded reference project, plus projects planned from a brief by a model and reviewed before they are created. Generated projects have agents and scenarios, no custom tools or code. | Projects that carry their own tools and generated application code. |
| **Running the agents** | In the Architect server process, on the server's model key. Preview at `/preview/<projectId>` runs the live versions through the same path verification uses. | An isolated per-project sandbox behind a preview gateway, with per-project credentials. |
| **Going live** | Applying a verified change is the release: the next request loads the new version. No build, no artifact. | A deploy queue, isolated builds and deployment workers. |
| **Ship to GitHub** | A verified, applied change opens a pull request holding the verified definitions and its verification record. One server-wide token and repository allowlist, set up around a demo repository. **Merging the PR deploys nothing**: it is a record, and both the PR and the UI say so. | A GitHub App each user installs on their own repositories, with a short-lived installation token per ship. |
| **Accounts** | Optional Google sign-in (Supabase Auth). A project belongs to whoever created it. | Teams, roles, quotas and rate limits. |
| **Jobs** | One job at a time, held in process memory; background work in `after()`; live progress by polling an events table over SSE. Sound for one server. | A Postgres lease and durable workers. |

[`docs/DEPLOYMENT.md` §8](docs/DEPLOYMENT.md#8-known-prototype-limitations) lists every prototype limit.

## Who can do what

With sign-in configured:

- The **reference example** is public to explore: workspace, agents, scenarios, activity, preview page. Changing,
  running, resetting or shipping it needs a signed-in account. It is one shared project for the whole deployment.
- A **generated project** is owner-only, to view and to change.
- One access check (`src/server/access.ts`) sits in front of every route and page, and runs before any write, model
  call or GitHub call. Shipping is authorized against the change's project first, then gated on verification.

Without sign-in configured (the local default) there are no accounts and everything is open.

## Architecture at a glance

One Next.js app (App Router): route handlers for actions, Server-Sent Events for progress, Postgres through Drizzle
(Supabase in production, in-process PGlite locally; one schema, one set of migrations). Agents run on the Vercel AI
SDK with Anthropic or OpenAI models, or on a deterministic fixture model.

| Path | What lives there |
| --- | --- |
| `src/runtime/`, `src/preview/` | Running an agent system: models, tool registry, the fixture model, preview turns |
| `src/scenarios/`, `src/verify/` | Scenarios, assertions, the runner, rule revisions, the structural check |
| `src/changes/` | Changes, verification, the LLM change proposer |
| `src/projects/`, `src/demo/`, `src/seed/` | Project definitions, planning from a brief, the Laptop Advisor demo |
| `src/shipping/`, `src/github/` | The ship gate, the PR artifact, the GitHub REST client |
| `src/db/`, `src/server/` | Schema and database engines; configuration, auth, access rules, the workspace read model |
| `src/app/`, `src/components/` | Routes, pages and the workspace UI |
| `scripts/` | Headless checks and the fake GitHub |

No queue, worker, sandbox or second service: those belong to the production design, and the documents say where
each one would go.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): how verification, preview, shipping and deployment work, prototype
  against production.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): local, live-model and Vercel + Supabase setup, every environment
  variable, sign-in, GitHub shipping, known limitations.
- [`.env.example`](.env.example): the configuration, with what each setup needs.
