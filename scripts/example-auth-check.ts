/**
 * pnpm example:auth-check
 * Deterministic coverage for the reference example's auth boundary: anyone can explore the demo, signing in is needed
 * to change or ship it, and a generated project stays owner-only. Drives the real route handlers and the real access
 * rules (src/server/access.ts) on fixture models, with shipping against the in-memory fake GitHub. Only the viewer
 * (src/server/auth.ts) and Next's request-scoped `after`/`connection` are substituted, since there is no request
 * outside Next; `after` jobs run immediately and are awaited. Every credential from .env.local is blanked and any
 * network call other than the fake GitHub throws.
 */
import { register } from "node:module";
import type { PgTable } from "drizzle-orm/pg-core";
import { mock } from "node:test";
import { createFakeGitHub } from "./fake-github";
import { c, heading } from "./report";

// Before any app module loads: process.loadEnvFile never overwrites a variable that is already set (even to "").
const TOKEN = "ghp_fake_token_for_tests_only";
const REPO = "acme/laptop-advisor-agents";
const FAKE_API = "https://fake-github.test";
Object.assign(process.env, {
  DATABASE_URL: "",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  ARCHITECT_PROJECT: "",
  ARCHITECT_PUBLIC_URL: "",
  ARCHITECT_MODEL_MODE: "fixture",
  ARCHITECT_JUDGE: "skip",
  ARCHITECT_PROPOSER: "fixture",
  ARCHITECT_GITHUB_TOKEN: TOKEN,
  ARCHITECT_GITHUB_REPOS: REPO,
  ARCHITECT_GITHUB_API_URL: FAKE_API,
});
delete process.env.VERCEL;

const fake = createFakeGitHub({ token: TOKEN, repos: [REPO] });
const blocked: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(FAKE_API)) return fake.fetch(input, init);
  blocked.push(url);
  throw new Error(`example-auth-check: network call blocked: ${url}`);
}) as typeof fetch;

type Viewer = { id: string; email: string | null; name: string | null; avatarUrl: string | null };
const auth: { enabled: boolean; viewer: Viewer | null } = { enabled: true, viewer: null };
const user = (id: string): Viewer => ({ id, email: `${id}@example.test`, name: id, avatarUrl: null });
const ALICE = user("user-alice");
const BOB = user("user-bob");

// By file URL: mock.module specifiers don't get the tsconfig `@/` alias. access.ts's `./auth` resolves to this URL.
const src = new URL("../src/", import.meta.url).href;
mock.module(new URL("server/auth.ts", src).href, {
  namedExports: {
    authStatus: () => ({ configured: auth.enabled, problems: [] }),
    authEnabled: () => auth.enabled,
    supabaseServer: async () => null,
    currentUser: async () => auth.viewer,
    authOrigin: (req: Request) => new URL(req.url).origin,
  },
});
// `after` and `connection` need a Next request scope. Background jobs run immediately and are awaited by `settle`.
const jobs: Promise<unknown>[] = [];
mock.module("next/server", {
  namedExports: {
    after: (job: () => Promise<unknown>) => void jobs.push(Promise.resolve().then(job)),
    connection: async () => {},
  },
});
const settle = async () => {
  while (jobs.length) await jobs.shift();
};

// Once Node's module-mock loader is registered, tsx no longer applies the `@/` alias to later imports, so map
// `@/` → src/ in a hook registered after it (hooks run last-registered first). Test plumbing only.
register(
  `data:text/javascript,${encodeURIComponent(
    `export const resolve = (s, c, next) => next(s.startsWith("@/") ? new URL(s.slice(2), ${JSON.stringify(src)}).href : s, c);`,
  )}`,
);

const { count, eq, isNotNull } = await import("drizzle-orm");
const { keepRuleAndFix, loadBlockedChangeContext, proposeChange, verifyChange } = await import("@/changes/change");
const { draftChange, draftFix, proposerConfig } = await import("@/changes/proposer");
const { agents, changeShipments, changes, events, projects, runs, scenarioVersions } = await import("@/db/schema");
const { RULE_CHANGE_REQUEST } = await import("@/demo/fixture-scenario-proposer");
const { laptopAdvisor } = await import("@/demo/project");
const { REGRESSION_INTENT } = await import("@/fixtures/regression");
const { toProjectRuntime } = await import("@/projects/registry");
const { loadCurrentVersions, loadScenarios } = await import("@/scenarios/runner");
const { proposeScenarioRevision } = await import("@/scenarios/revisions");
const { openProject, SignInRequired } = await import("@/server/access");
const { busyJob, getDb } = await import("@/server/context");
const route = {
  changes: await import("../src/app/api/changes/route"),
  fix: await import("../src/app/api/changes/[changeId]/fix/route"),
  apply: await import("../src/app/api/changes/[changeId]/apply/route"),
  ship: await import("../src/app/api/changes/[changeId]/ship/route"),
  revisions: await import("../src/app/api/scenario-revisions/route"),
  revisionApply: await import("../src/app/api/scenario-revisions/[revisionId]/apply/route"),
  revisionDiscard: await import("../src/app/api/scenario-revisions/[revisionId]/discard/route"),
  runs: await import("../src/app/api/runs/route"),
  reset: await import("../src/app/api/reset/route"),
  preview: await import("../src/app/api/preview/route"),
  workspace: await import("../src/app/api/workspace/route"),
  events: await import("../src/app/api/events/route"),
};

const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? c.green("  ✔") : c.red("  ✘")} ${what}`);
  if (!ok) problems.push(what);
};

type As = { enabled?: boolean; viewer: Viewer | null };
type Reply = { status: number; body: Record<string, unknown> };
const as = (who: As) => {
  auth.enabled = who.enabled ?? true;
  auth.viewer = who.viewer;
};
const reply = async (res: Response): Promise<Reply> => ({ status: res.status, body: await res.json().catch(() => ({})) });
const post = (url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const params = <K extends string>(key: K, id: string) => ({ params: Promise.resolve({ [key]: id } as Record<K, string>) });

const { db, kind } = await getDb();
const runtime = toProjectRuntime(laptopAdvisor);
const fixtureOpts = { mode: "fixture" as const, judge: "skip" as const, runtime };
const proposer = { mode: "fixture" as const, model: proposerConfig().model };
const projectNow = async () => (await db.select().from(projects).where(eq(projects.slug, laptopAdvisor.slug)))[0];

/** Every operation this boundary gates, by name, against the given project and its seeded states. */
type States = { projectId: string; blocked: string; verified: string; revision: string };
const gated = (s: States, who: As): [string, () => Promise<Reply>][] => {
  const q = `?project=${s.projectId}`;
  const call = async (fn: () => Promise<Response>) => {
    as(who);
    const r = await reply(await fn());
    await settle();
    return r;
  };
  return [
    ["propose a change", () => call(() => route.changes.POST(post(`/api/changes${q}`, { intent: REGRESSION_INTENT })))],
    ["fix a change", () => call(() => route.fix.POST(post(`/api/changes/${s.blocked}/fix`), params("changeId", s.blocked)))],
    ["apply a change", () => call(() => route.apply.POST(post(`/api/changes/${s.verified}/apply`), params("changeId", s.verified)))],
    ["ship to GitHub", () => call(() => route.ship.POST(post(`/api/changes/${s.verified}/ship`, {}), params("changeId", s.verified)))],
    [
      "draft a rule change",
      () =>
        call(() =>
          route.revisions.POST(post("/api/scenario-revisions", { changeId: s.blocked, scenarioKey: "no-match-honesty", request: RULE_CHANGE_REQUEST })),
        ),
    ],
    ["apply a rule change", () => call(() => route.revisionApply.POST(post(`/api/scenario-revisions/${s.revision}/apply`), params("revisionId", s.revision)))],
    ["discard a rule change", () => call(() => route.revisionDiscard.POST(post(`/api/scenario-revisions/${s.revision}/discard`), params("revisionId", s.revision)))],
    ["run scenarios", () => call(() => route.runs.POST(post(`/api/runs${q}`)))],
    ["reset the project", () => call(() => route.reset.POST(post(`/api/reset${q}`)))],
    ["chat with the agents (preview)", () => call(() => route.preview.POST(post(`/api/preview${q}`, { message: "I need a laptop for school" })))],
  ];
};

/** Everything a gated operation could have written, plus GitHub and the job lock. */
const footprint = async () => {
  const rows = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;
  return JSON.stringify({
    projects: await db.select({ id: projects.id, slug: projects.slug }).from(projects),
    agents: await db.select({ id: agents.id, live: agents.currentVersionId }).from(agents),
    changes: await db.select({ id: changes.id, status: changes.status, resolution: changes.resolution }).from(changes),
    events: await rows(events),
    runs: await rows(runs),
    revisions: await rows(scenarioVersions),
    settled: (await db.select({ n: count() }).from(scenarioVersions).where(isNotNull(scenarioVersions.discardedAt)))[0].n,
    shipments: await rows(changeShipments),
    github: fake.calls.length,
    busy: busyJob(),
  });
};

/** A blocked change, a verified fix of another blocked change, and a proposed rule revision — stored directly. */
const seedStates = async (projectId: string): Promise<States> => {
  const blockedChange = async () => {
    const draft = await draftChange({ intent: REGRESSION_INTENT, versions: await loadCurrentVersions(db, projectId), runtime, config: proposer });
    const change = await proposeChange(db, { projectId, intent: REGRESSION_INTENT, edits: draft.edits, proposal: draft.proposal });
    await verifyChange(db, change.id, fixtureOpts);
    return change;
  };
  const blocked = await blockedChange();
  const toFix = await blockedChange();
  const ctx = await loadBlockedChangeContext(db, toFix.id);
  const fixDraft = await draftFix({
    intent: toFix.intent,
    live: ctx.live,
    blocked: ctx.blocked,
    editedAgents: Object.keys(toFix.proposedVersionIds),
    scenarios: ctx.scenarios,
    results: ctx.results,
    runtime,
    config: proposer,
  });
  const fix = await keepRuleAndFix(db, toFix.id, fixDraft.edits, fixDraft.proposal);
  await verifyChange(db, fix.id, fixtureOpts);
  const scenario = (await loadScenarios(db, projectId)).find((s) => s.key === "no-match-honesty")!;
  const revision = await proposeScenarioRevision(db, {
    projectId,
    scenarioKey: scenario.key,
    content: { name: scenario.name, intent: `${scenario.intent} (draft)`, input: scenario.input, assertions: scenario.assertions },
    request: "example-auth-check draft",
    proposal: { mode: "fixture", model: "none", rationale: "example-auth-check" },
    changeId: blocked.id,
  });
  const [b] = await db.select().from(changes).where(eq(changes.id, blocked.id));
  const [f] = await db.select().from(changes).where(eq(changes.id, fix.id));
  check(b.status === "behavioral_failed" && f.status === "verified", "   seeded: a blocked change, a verified fix, a proposed rule revision");
  return { projectId, blocked: blocked.id, verified: fix.id, revision: revision.id };
};

// ---------------------------------------------------------------------------------------------------------------
let example = await projectNow();

heading("A. Signed out: the reference example is open to explore");
as({ viewer: null });
const workspace = await reply(await route.workspace.GET(new Request(`http://localhost/api/workspace?project=${example.id}`)));
check(
  workspace.status === 200 && (workspace.body.agents as unknown[])?.length === 3 && (workspace.body.scenarios as unknown[])?.length > 0,
  `GET /api/workspace: 200, ${(workspace.body.agents as unknown[])?.length} agents and ${(workspace.body.scenarios as unknown[])?.length} scenarios to inspect`,
);
const abort = new AbortController();
const stream = await route.events.GET(new Request(`http://localhost/api/events?project=${example.id}`, { signal: abort.signal }));
const reader = stream.body!.getReader();
const first = new TextDecoder().decode((await reader.read()).value);
abort.abort();
await reader.cancel();
check(stream.status === 200 && first.startsWith("retry:"), "GET /api/events: 200, the activity stream opens");
const opened = await openProject(db, example.id).then((p) => p.id, () => null);
check(opened === example.id, "openProject (what /workspace and /preview/[id] call to render) opens it");
const refused = await openProject(db, example.id, "change").then(() => null, (err) => err);
check(refused instanceof SignInRequired, "…but opening it to change it asks the viewer to sign in");

heading("B. Signed out: every change, spend or ship on the example needs sign-in");
const bStates = await seedStates(example.id);
const before = await footprint();
for (const [what, run] of gated(bStates, { viewer: null })) {
  const r = await run();
  check(
    r.status === 401 && r.body.error === "Anyone can explore the demo. Sign in with Google to change or ship it.",
    `${what}: ${r.status} ${r.body.error ?? ""}`,
  );
}
check((await footprint()) === before, "   nothing was written, no job started, no GitHub call made");

heading("C. Signed in (not an owner — the example has none): the full demo flow still works");
as({ viewer: BOB });
const step = async (what: string, res: Promise<Response>, ok: number) => {
  const r = await reply(await res);
  await settle();
  check(r.status === ok, `${what}: ${r.status}${r.status === ok ? "" : ` ${r.body.error}`}`);
  return r.body;
};
const q = `?project=${example.id}`;
await step("run scenarios", route.runs.POST(post(`/api/runs${q}`)), 202);
const proposed = await step("propose a change", route.changes.POST(post(`/api/changes${q}`, { intent: REGRESSION_INTENT })), 202);
const changeId = proposed.changeId as string;
const [regressed] = await db.select().from(changes).where(eq(changes.id, changeId));
check(regressed?.status === "behavioral_failed", "   it is verified in the background and blocked by a scenario");
const ruleBody = { changeId, scenarioKey: "no-match-honesty", request: RULE_CHANGE_REQUEST };
const draft1 = await step("draft a rule change", route.revisions.POST(post("/api/scenario-revisions", ruleBody)), 201);
await step("discard a rule change", route.revisionDiscard.POST(post("/x"), params("revisionId", draft1.revisionId as string)), 200);
const draft2 = await step("draft it again", route.revisions.POST(post("/api/scenario-revisions", ruleBody)), 201);
const fixed = await step("fix a change", route.fix.POST(post("/x"), params("changeId", changeId)), 202);
const fixId = fixed.changeId as string;
await step("apply a change", route.apply.POST(post("/x"), params("changeId", fixId)), 202);
const shipped = await step("ship to GitHub", route.ship.POST(post("/x", {}), params("changeId", fixId)), 201);
check(fake.repo(REPO).pulls.length === 1, `   PR #${(shipped.shipment as { prNumber?: number })?.prNumber} opened on the fake GitHub`);
await step("apply a rule change", route.revisionApply.POST(post("/x"), params("revisionId", draft2.revisionId as string)), 202);
await step("chat with the agents (preview)", route.preview.POST(post(`/api/preview${q}`, { message: "I need a laptop for school" })), 200);
await step("reset the project", route.reset.POST(post(`/api/reset${q}`)), 200);

heading("D. A generated project stays owner-only, for viewing and for changing");
example = await projectNow();
const dStates = await seedStates(example.id);
// Alice's generated project: a slug with no code definition behind it is not an example.
await db.update(projects).set({ slug: "alices-laptop-advisor", ownerId: ALICE.id }).where(eq(projects.id, example.id));
const view = async (who: As) => {
  as(who);
  return reply(await route.workspace.GET(new Request(`http://localhost/api/workspace?project=${example.id}`)));
};
check((await view({ viewer: BOB })).status === 403, "Bob can't view Alice's project (403)");
check((await view({ viewer: null })).status === 403, "a signed-out viewer can't view it either (403, not a sign-in prompt)");
const dBefore = await footprint();
for (const who of [
  { label: "Bob", as: { viewer: BOB } },
  { label: "signed out", as: { viewer: null } },
]) {
  const results = [];
  for (const [what, run] of gated(dStates, who.as)) results.push([what, await run()] as const);
  const wrong = results.filter(([, r]) => r.status !== 403 || r.body.error !== "This project belongs to someone else.");
  check(wrong.length === 0, `${who.label}: 403 on all ${results.length} operations${wrong.length ? ` — not on ${wrong.map(([w, r]) => `${w} (${r.status})`).join(", ")}` : ""}`);
}
check((await footprint()) === dBefore, "   nothing was written, no job started, no GitHub call made");
check((await view({ viewer: ALICE })).status === 200, "Alice views her project (200)");
as({ viewer: ALICE });
const aliceDiscard = await reply(await route.revisionDiscard.POST(post("/x"), params("revisionId", dStates.revision)));
check(aliceDiscard.status === 200, `Alice discards her rule-change draft (${aliceDiscard.status})`);
// Offline, a generated project has no fixture behavior, so a run stops at the runtime check — after access passed.
const aliceRun = await reply(await route.runs.POST(post(`/api/runs?project=${example.id}`)));
check(aliceRun.status === 503, `Alice's run passes the access check (then ${aliceRun.status}: generated projects need real models)`);
await settle();

heading("Sign-in switched off on the server");
await db.update(projects).set({ slug: laptopAdvisor.slug, ownerId: null }).where(eq(projects.id, example.id));
as({ enabled: false, viewer: null });
check((await reply(await route.runs.POST(post(`/api/runs?project=${example.id}`)))).status === 202, "the example can be changed by anyone, as before accounts existed (202)");
await settle();

heading("Isolation");
check(kind === "pglite", `ran on the in-process database (${kind}), not DATABASE_URL`);
check(blocked.length === 0, `no network call left the process${blocked.length ? `: ${blocked.join(", ")}` : ""}`);

heading("Result");
if (problems.length) {
  console.log(c.red(`${problems.length} check(s) failed.`));
  process.exitCode = 1;
} else {
  console.log(c.green("Example project auth boundary: all checks passed."));
}
