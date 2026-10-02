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

## Phases

- Phase 1 (current): headless vertical slice — catalog seed, agents + immutable versions, scenarios,
  agent runtime, assertions, structural check, Change creation, regression + fix fixtures,
  `pnpm scenarios:run` and `pnpm scenarios:regress`.
- Not yet: UI, GitHub, E2B, auth, full docs.
