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
Anthropic + OpenAI, SSE. Later: Octokit/GitHub App. E2B only if there is time.

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
- `src/changes/proposer.ts` maps the scripted demo request to fixture edits; free-form requests are rejected
  until the LLM proposer exists.
- UI env: `ARCHITECT_MODEL_MODE=live`, `ARCHITECT_JUDGE=live`. PGlite state is per server process.
- Pure helpers for client code live in `src/domain/format.ts`; never import AI SDK or DB modules into components.

## Phases

- Phase 1 (done): headless vertical slice — catalog seed, agents + immutable versions, scenarios,
  agent runtime, assertions, structural check, Change creation, regression + fix fixtures,
  `pnpm scenarios:run` and `pnpm scenarios:regress`.
- Phase 2 (done): workspace UI — Scenario strip, Scenario inspector, Agent inspector, Change/Verdict drawer,
  regression flow over SSE.
- Not yet: LLM change proposer, "Change the rule", GitHub, E2B, auth, full docs.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
