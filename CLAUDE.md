# Architect 2.0 — Lyzr hiring assignment

Architect 2.0 turns user intent into persistent **Scenarios** that verify agent behavior after every relevant change.

The owner holds the full product spec separately. Do not redesign the product or do broad research.

## Key demo

1. Initial agent → scenarios pass.
2. User asks: "Make the Recommendation Agent more confident and persuasive. Customers hate hearing no."
3. Structural configuration stays valid.
4. A behavioral scenario fails.
5. The product explains why.
6. User chooses "Keep the rule → Fix it".
7. The agent is fixed → scenarios pass again.

## Demo application: laptop advisor

- Agents: Store Advisor, Needs Analyst, Recommendation Agent
- Tool: `search_catalog`
- Domain objects: Project, Agent, AgentVersion (immutable), Scenario, Change, Run, events
- Scenario assertion types (ONLY these): `tool`, `output`, `judge`
- Operators (ONLY these): `eq`, `neq`, `lte`, `gte`, `contains`, `exists`, `is_null`
- Prefer deterministic reproduction over relying entirely on an LLM judge.

## Stack

Next.js App Router, TypeScript, Tailwind, shadcn/ui, Supabase Postgres, Drizzle, Zod, Vercel AI SDK,
Anthropic + OpenAI, SSE. GitHub via REST over fetch (no Octokit). E2B only if there is time.

## Do NOT add

Kubernetes, microservices, Redis, Kafka, Temporal/Inngest/BullMQ, WebSockets, LangChain/LangGraph,
multiple sandbox providers, custom auth, RBAC, billing, collaboration, unnecessary abstractions.

## Working rules

- The owner makes product and architecture decisions. Claude Code is the implementation assistant.
- NEVER run `git commit`, `git push`, `git rebase`, `gh`, or open PRs. The owner does all Git operations.
- Do not add dependencies without telling the owner first.
- Do not silently change the architecture.
- Do not expand scope. Finish the current phase, report, and stop. Do not continue into the next phase automatically.

## Decisions (approved by owner, Phase 1)

- DB: Drizzle on Postgres. `DATABASE_URL` set → Supabase via `postgres` (postgres.js); unset → in-process
  PGlite (`@electric-sql/pglite`), fresh per run. Migrations in `drizzle/` (`pnpm db:generate`), applied on open.
- Determinism: agents run on a deterministic fixture model (`src/runtime/fixture-model.ts`, AI SDK
  `MockLanguageModelV4`) by default. `--live` uses the provider model in each AgentVersion config.
  Judge assertions run only with `--judge`/`--live` and an API key; otherwise they report `skipped`.
  tool/output assertions decide pass/fail.
- Scripts run TypeScript through `tsx` (Node 22.5 can't strip types).
- AI SDK is v7: `instructions` (not `system`), `isStepCount`, `Output.object`.
- Failed Changes are gated: an agent's `currentVersionId` only moves when a verified Change is applied.

## Commands

- `pnpm scenarios:run [--reset] [--judge] [--live]`: run all scenarios against the current agent versions.
- `pnpm scenarios:regress [--judge] [--live]`: the key demo end to end; exits non-zero if any step deviates.
- `pnpm ship:check [--print]`: Ship to GitHub against an in-memory fake GitHub (gate, branch/commit/PR, provenance,
  duplicates, failure events). Never calls the real GitHub.
- `pnpm typecheck`, `pnpm db:generate`.

## Workspace UI (Phase 2)

- `pnpm dev` → http://localhost:3000. Single demo project; `/` renders the workspace.
- Server: `src/server/context.ts` (one DB handle per process on `globalThis`, background jobs via Next `after()`,
  one job at a time), `src/server/workspace.ts` (the single read model the UI renders).
- Routes (`src/app/api/*`): `GET workspace`, `GET events` (SSE, polls the events table from `?after=seq`),
  `POST runs`, `POST changes`, `POST changes/:id/fix`, `POST changes/:id/apply` (applies, then re-runs scenarios),
  `POST reset`.
- Client (`src/components/workspace/*`): `useWorkspace` = snapshot + EventSource; events drive live progress and
  a debounced snapshot refetch.
- Change proposer (`src/changes/proposer.ts`): `draftChange` / `draftFix` call an LLM via `generateText` +
  `Output.object` (Zod schema limited to real agent keys, registered tools, existing handoff targets; nullable =
  keep). Editable fields: `instructions`, `role`, `tools`, `handoffs`. Drafts never skip verification.
  The draft prompt sees live configs + request only (not scenarios); the fix prompt also sees protected behaviors
  and the blocked change's failures. Rationale/mode/model are stored in `changes.proposal`.
  `ARCHITECT_PROPOSER=live|fixture` (unset → live if the key exists), `ARCHITECT_PROPOSER_MODEL`
  (default `anthropic:claude-opus-5-5`). Fixture mode (`fixture-proposer.ts`) replays the demo edits through
  the same structured-output path. Routes draft synchronously under the busy lock and emit
  `change.drafting` / `change.draft_failed`.
- UI env: `ARCHITECT_MODEL_MODE=live`, `ARCHITECT_JUDGE=live`. PGlite state is per server process.
- Pure helpers for client code live in `src/domain/format.ts`; never import AI SDK or DB modules into components.

### UX principles (final pass)

- Every object has two faces: plain language by default, the exact form one click away behind `Disclosure`
  ("7 checks", "5 structural checks", "Agent traces", "N versions of this rule"). No global developer mode.
- Configuration and behavior are separate verdicts (`behavior-verdict.tsx`): valid config + broken behavior is the
  product's point, so a structurally-failed change reports behavior as "Not checked", never as correct or broken.
- A blocked change leads with what the customer would have heard, then Expected/Actual, then the fork:
  KEEP THE RULE = "the agent is wrong", CHANGE THE RULE = "the requirement changed".
- Server/infrastructure state is progressively disclosed: the header shows only "Demo mode"/"Live mode"; storage,
  proposer, agent runtime, judge and GitHub (with their env var names) live in the Environment popover
  (`environment.tsx`). Product surfaces never print env vars or shell commands — `friendlyError` in
  `components/workspace/format.ts` translates configuration limits into "not enabled in Demo mode".
- The Inspector opens on the project (`project-overview.tsx`), not on an arbitrary scenario; the center column is
  the workflow when there are no changes and the change workspace once one exists.

## Scenario revisions ("Change the rule", Phase 4)

- Two resolutions of a blocked Change, kept distinct everywhere (UI, data, events):
  KEEP THE RULE = fix the implementation (child Change, agents edited, `resolution: keep_rule_fix`);
  CHANGE THE RULE = update the requirement (new scenario version, agents untouched, `resolution: change_rule`).
- Scenarios mirror agents: `scenarios` holds identity + `currentVersionId`; `scenario_versions` is immutable content
  (`name`, `intent`, `input`, `assertions`) + provenance (`basedOnVersionId`, `changeId`, `request`, `proposal`) and
  `appliedAt` / `discardedAt`. `loadScenarios` returns the live version; run results record `scenarioVersionId`.
- Scenario proposer (`src/scenarios/proposer.ts`): separate from the Change proposer, same live/fixture switch.
  Structured output limited to tool/output/judge + existing operators, real agents/tools; rejects judge-only rules,
  bad values, unknown paths (via `checkStructure`), identical rules; `representable: false` → explanation.
  Fixture (`src/scenarios/fixture-proposer.ts`) knows only the scripted $600 → $900 request.
- Flow (`src/scenarios/revisions.ts`): draft = proposed version (live rule untouched) → user reviews diff → explicit
  apply (stale + structural guards, pointer moves, change marked `change_rule` and set back to `proposed`) → background
  `verifyRuleChange`: all scenarios vs live agents, then `verifyChange` on the blocked change. Failures stay failures.
- Routes: `POST /api/scenario-revisions`, `POST /api/scenario-revisions/:id/apply`, `POST .../:id/discard`.
- The demo stays in USD (owner's decision): the no-match scenario is "gaming laptop under $600, never recommend above
  the budget"; the scripted rule change is "allow up to $900 when nothing suitable exists under $600".

## Ship to GitHub (Phase 5)

- Invariant: a Change ships only after verification. `src/shipping/gate.ts` (server-enforced, read-only): applied,
  structural ok, passing verification run, live agents == that run's version set, a live run since apply where every
  current scenario version passes. The workspace shows the same gate (`change.ship`) for applied changes.
- `src/shipping/ship.ts`: claim (`change_shipments`, unique per change) → branch `architect/change-<id>` from the default
  branch → one commit (`src/shipping/artifact.ts`: `architect/agents|scenarios|changes/*` JSON, honest prototype
  representation, no timestamps in agent/scenario files) → PR. Idempotent: shipped → recorded PR (no GitHub calls);
  retry reuses branch, skips identical tree, reuses PR. Events: `change.shipping` / `change.shipped` / `change.ship_failed`.
- `src/github/provider.ts`: the only GitHub client (REST over fetch, no SDK); token from a supplier.
  `src/github/config.ts`: `ARCHITECT_GITHUB_TOKEN`, `ARCHITECT_GITHUB_REPOS` (allowlist), optional `ARCHITECT_PUBLIC_URL`,
  `ARCHITECT_GITHUB_API_URL`. Server-only; the client only sees `env.github` (configured, repositories, problems).
- Route: `POST /api/changes/:id/ship` `{repository?}` → 201 shipped, 200 already shipped, 404/409 gate, 400 repo not
  allowed, 503 not configured, 502 GitHub error. `/?change=<id>` opens a change (linked from the PR).
- Production design (documented, not built): GitHub App → short-lived installation token. See `docs/architecture.md`.

## Phases

- Phase 1 (done): headless vertical slice — catalog seed, agents + immutable versions, scenarios,
  agent runtime, assertions, structural check, Change creation, regression + fix fixtures,
  `pnpm scenarios:run` and `pnpm scenarios:regress`.
- Phase 2 (done): workspace UI — Scenario strip, Scenario inspector, Agent inspector, Change/Verdict drawer,
  regression flow over SSE.
- LLM change proposer (done): replaces the demo-only lookup; verification flow unchanged.
- Phase 4 (done): "Change the rule" with versioned scenarios and an LLM Scenario proposer.
- Phase 5 (done): Ship to GitHub (verified, applied change → branch, commit, pull request).
- Not yet: E2B / generated-app execution, auth, GitHub App installation flow.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
