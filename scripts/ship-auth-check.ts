/**
 * pnpm ship:auth-check
 * Deterministic coverage for who may call POST /api/changes/:id/ship. Drives the real route handler, the real
 * project access rules (src/server/access.ts) and the real shipChange against the in-memory fake GitHub; only the
 * viewer (src/server/auth.ts) is substituted, since there is no request cookie outside Next. Never touches the real
 * GitHub, Supabase or a model: every credential from .env.local is blanked and any other network call throws.
 */
import { register } from "node:module";
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
  throw new Error(`ship-auth-check: network call blocked: ${url}`);
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

// Once Node's module-mock loader is registered, tsx no longer applies the `@/` alias to later imports, so map
// `@/` → src/ in a hook registered after it (hooks run last-registered first). Test plumbing only.
register(
  `data:text/javascript,${encodeURIComponent(
    `export const resolve = (s, c, next) => next(s.startsWith("@/") ? new URL(s.slice(2), ${JSON.stringify(src)}).href : s, c);`,
  )}`,
);

const { and, eq } = await import("drizzle-orm");
const { applyChange, keepRuleAndFix, loadBlockedChangeContext, proposeChange, verifyChange } = await import("@/changes/change");
const { draftChange, draftFix, proposerConfig } = await import("@/changes/proposer");
const { changeShipments, events, projects } = await import("@/db/schema");
const { laptopAdvisor } = await import("@/demo/project");
const { REGRESSION_INTENT } = await import("@/fixtures/regression");
const { toProjectRuntime } = await import("@/projects/registry");
const { loadCurrentVersions, runScenarios } = await import("@/scenarios/runner");
const { checkShipGate } = await import("@/shipping/gate");
const { getDb } = await import("@/server/context");
const { POST } = await import("../src/app/api/changes/[changeId]/ship/route");

const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? c.green("  ✔") : c.red("  ✘")} ${what}`);
  if (!ok) problems.push(what);
};

const ship = async (changeId: string, as: { enabled?: boolean; viewer: Viewer | null }) => {
  auth.enabled = as.enabled ?? true;
  auth.viewer = as.viewer;
  const res = await POST(
    new Request(`http://localhost/api/changes/${changeId}/ship`, { method: "POST", body: JSON.stringify({}) }),
    { params: Promise.resolve({ changeId }) },
  );
  return { status: res.status, body: (await res.json()) as { error?: string; alreadyShipped?: boolean; shipment?: { prNumber: number } } };
};

const { db, kind } = await getDb();
const opts = { mode: "fixture" as const, judge: "skip" as const, runtime: toProjectRuntime(laptopAdvisor) };
const proposer = { mode: "fixture" as const, model: proposerConfig().model };
const [demo] = await db.select().from(projects).where(eq(projects.slug, laptopAdvisor.slug));
const projectId = demo.id;

heading("Setup: a change that passes every ship gate (fixture models, fake GitHub)");
const draft = await draftChange({ intent: REGRESSION_INTENT, versions: await loadCurrentVersions(db, projectId), runtime: opts.runtime, config: proposer });
const persuasive = await proposeChange(db, { projectId, intent: REGRESSION_INTENT, edits: draft.edits, proposal: draft.proposal });
await verifyChange(db, persuasive.id, opts);
const ctx = await loadBlockedChangeContext(db, persuasive.id);
const fixDraft = await draftFix({
  intent: persuasive.intent,
  live: ctx.live,
  blocked: ctx.blocked,
  editedAgents: Object.keys(persuasive.proposedVersionIds),
  scenarios: ctx.scenarios,
  results: ctx.results,
  runtime: opts.runtime,
  config: proposer,
});
const fix = await keepRuleAndFix(db, persuasive.id, fixDraft.edits, fixDraft.proposal);
await verifyChange(db, fix.id, opts);
await applyChange(db, fix.id);
await runScenarios(db, { projectId, versions: await loadCurrentVersions(db, projectId), trigger: "manual", ...opts });
check((await checkShipGate(db, fix.id)).ok, "the fix is applied, re-verified on the live agents, and ready to ship");

// Turn the seeded project into a generated one owned by Alice: a slug with no code definition is not an example.
await db.update(projects).set({ slug: "alices-laptop-advisor", ownerId: ALICE.id }).where(eq(projects.id, projectId));

const sideEffects = async () => ({
  shipments: (await db.select().from(changeShipments).where(eq(changeShipments.changeId, fix.id))).length,
  shipEvents: (await db.select().from(events).where(and(eq(events.changeId, fix.id), eq(events.type, "change.shipping")))).length,
  githubCalls: fake.calls.length,
});
const untouched = (s: Awaited<ReturnType<typeof sideEffects>>) => s.shipments === 0 && s.shipEvents === 0 && s.githubCalls === 0;

heading("B. Signed in, but not the project's owner");
const asBob = await ship(fix.id, { viewer: BOB });
check(asBob.status === 403, `Bob gets 403: ${asBob.body.error}`);
check(untouched(await sideEffects()), "   shipChange never ran: no shipment claim, no change.shipping event, no GitHub call");

heading("C. Signed out, with sign-in enabled");
const signedOut = await ship(fix.id, { viewer: null });
check(signedOut.status === 403, `a signed-out request gets 403: ${signedOut.body.error}`);
check(untouched(await sideEffects()), "   shipChange never ran: no shipment claim, no change.shipping event, no GitHub call");

heading("Unknown or malformed change ids");
const missing = await ship("00000000-0000-4000-8000-000000000000", { viewer: BOB });
check(missing.status === 404 && missing.body.error === "Change not found.", `an unknown change id is 404: ${missing.body.error}`);
const malformed = await ship("not-a-uuid", { viewer: BOB });
check(malformed.status === 404, `a malformed change id is 404: ${malformed.body.error}`);
check(untouched(await sideEffects()), "   and neither reached shipChange");

heading("A. The project's owner");
const asAlice = await ship(fix.id, { viewer: ALICE });
check(asAlice.status === 201 && asAlice.body.alreadyShipped === false, `Alice ships it: ${asAlice.status}, PR #${asAlice.body.shipment?.prNumber}`);
const repo = fake.repo(REPO);
check(repo.pulls.length === 1 && fake.calls.length > 0, "   through the fake GitHub: one pull request opened");
const again = await ship(fix.id, { viewer: ALICE });
check(again.status === 200 && again.body.alreadyShipped === true, "   shipping again returns the recorded PR (200)");
const bobAfter = await ship(fix.id, { viewer: BOB });
check(bobAfter.status === 403, "   Bob still can't read the shipment back through the ship endpoint");

heading("Sign-in switched off on the server");
const noAuth = await ship(fix.id, { enabled: false, viewer: null });
check(noAuth.status === 200 && noAuth.body.alreadyShipped === true, "every project is reachable, as before accounts existed (200, already shipped)");

heading("D. The reference example: any signed-in user may ship it, a signed-out viewer may not");
await db.update(projects).set({ slug: laptopAdvisor.slug, ownerId: null }).where(eq(projects.id, projectId));
const callsBefore = fake.calls.length;
const exampleBob = await ship(fix.id, { viewer: BOB });
check(exampleBob.status === 200 && exampleBob.body.alreadyShipped === true, "any signed-in user may call ship on the example (200, already shipped)");
const exampleSignedOut = await ship(fix.id, { viewer: null });
check(exampleSignedOut.status === 401, `a signed-out viewer is asked to sign in (401): ${exampleSignedOut.body.error}`);
check(fake.calls.length === callsBefore && repo.pulls.length === 1, "   without a second GitHub call or pull request");

heading("Isolation");
check(kind === "pglite", `ran on the in-process database (${kind}), not DATABASE_URL`);
check(blocked.length === 0, `no network call left the process${blocked.length ? `: ${blocked.join(", ")}` : ""}`);

heading("Result");
if (problems.length) {
  console.log(c.red(`${problems.length} check(s) failed.`));
  process.exitCode = 1;
} else {
  console.log(c.green("Ship authorization: all checks passed."));
}
