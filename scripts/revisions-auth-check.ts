/**
 * pnpm revisions:auth-check
 * Deterministic coverage for who may call POST /api/scenario-revisions/:id/discard. Drives the real route handler,
 * the real project access rules (src/server/access.ts) and the real discardScenarioRevision; only the viewer
 * (src/server/auth.ts) is substituted, since there is no request cookie outside Next. Revisions are stored directly
 * with proposeScenarioRevision, so no proposer model is involved. Never touches a model, GitHub or Supabase: every
 * credential from .env.local is blanked and any network call throws.
 */
import { register } from "node:module";
import { mock } from "node:test";
import { c, heading } from "./report";

// Before any app module loads: process.loadEnvFile never overwrites a variable that is already set (even to "").
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
  ARCHITECT_GITHUB_TOKEN: "",
  ARCHITECT_GITHUB_REPOS: "",
});
delete process.env.VERCEL;

const network: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  network.push(url);
  throw new Error(`revisions-auth-check: network call blocked: ${url}`);
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

const { eq } = await import("drizzle-orm");
const { events, projects, scenarioVersions } = await import("@/db/schema");
const { laptopAdvisor } = await import("@/demo/project");
const { toProjectRuntime } = await import("@/projects/registry");
const { loadScenarios } = await import("@/scenarios/runner");
const { applyScenarioRevision, proposeScenarioRevision } = await import("@/scenarios/revisions");
const { getDb } = await import("@/server/context");
const { POST } = await import("../src/app/api/scenario-revisions/[revisionId]/discard/route");

const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? c.green("  ✔") : c.red("  ✘")} ${what}`);
  if (!ok) problems.push(what);
};

const discard = async (revisionId: string, as: { enabled?: boolean; viewer: Viewer | null }) => {
  auth.enabled = as.enabled ?? true;
  auth.viewer = as.viewer;
  const res = await POST(new Request(`http://localhost/api/scenario-revisions/${revisionId}/discard`, { method: "POST" }), {
    params: Promise.resolve({ revisionId }),
  });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
};

const { db, kind } = await getDb();
const [demo] = await db.select().from(projects).where(eq(projects.slug, laptopAdvisor.slug));
const projectId = demo.id;
const runtime = toProjectRuntime(laptopAdvisor);

const state = async (id: string) => {
  const [row] = await db.select().from(scenarioVersions).where(eq(scenarioVersions.id, id));
  return { appliedAt: row.appliedAt, discardedAt: row.discardedAt };
};
const discardEvents = async (id: string) =>
  (await db.select().from(events).where(eq(events.type, "scenario.revision_discarded"))).filter((e) => e.payload.revisionId === id).length;
/** The revision is still pending and nothing announced it as discarded. */
const untouched = async (id: string) => {
  const s = await state(id);
  return s.discardedAt === null && s.appliedAt === null && (await discardEvents(id)) === 0;
};

heading("Setup: proposed revisions on the reference project (stored directly, no proposer model)");
const [first, second] = await loadScenarios(db, projectId);
let n = 0;
const propose = async (scenario: typeof first = first) =>
  (
    await proposeScenarioRevision(db, {
      projectId,
      scenarioKey: scenario.key,
      content: { name: scenario.name, intent: `${scenario.intent} (draft ${++n})`, input: scenario.input, assertions: scenario.assertions },
      request: `test draft ${n}`,
      proposal: { mode: "fixture", model: "none", rationale: "revisions-auth-check" },
    })
  ).id;
const forBob = await propose();
const forSignedOut = await propose();
const forOwner = await propose();
const forNoAuth = await propose();
const forExampleBob = await propose();
const forExampleSignedOut = await propose();
const applied = await propose(second);
await applyScenarioRevision(db, applied, runtime.tools);
check((await state(applied)).appliedAt !== null, `${n} revisions proposed; one applied through applyScenarioRevision`);

// Turn the seeded project into a generated one owned by Alice: a slug with no code definition is not an example.
await db.update(projects).set({ slug: "alices-laptop-advisor", ownerId: ALICE.id }).where(eq(projects.id, projectId));

heading("B. Signed in, but not the project's owner");
const asBob = await discard(forBob, { viewer: BOB });
check(asBob.status === 403, `Bob gets 403: ${asBob.body.error}`);
check(await untouched(forBob), "   the revision is untouched: no discardedAt, no scenario.revision_discarded event");
const bobApplied = await discard(applied, { viewer: BOB });
check(bobApplied.status === 403, "   an applied revision is also 403 for Bob: authorization runs before the state rule");

heading("C. Signed out, with sign-in enabled");
const signedOut = await discard(forSignedOut, { viewer: null });
check(signedOut.status === 403, `a signed-out request gets 403: ${signedOut.body.error}`);
check(await untouched(forSignedOut), "   the revision is untouched: no discardedAt, no scenario.revision_discarded event");

heading("E. Unknown or malformed revision ids");
const unknown = await discard("00000000-0000-4000-8000-000000000000", { viewer: ALICE });
check(unknown.status === 404 && unknown.body.error === "Scenario revision not found.", `an unknown revision id is 404: ${unknown.body.error}`);
const malformed = await discard("not-a-uuid", { viewer: ALICE });
check(malformed.status === 404, `a malformed revision id is 404 (as on the apply route): ${malformed.body.error}`);

heading("F. An applied revision, as its owner");
const ownerApplied = await discard(applied, { viewer: ALICE });
check(
  ownerApplied.status === 409 && ownerApplied.body.error === "An applied revision can't be discarded.",
  `still 409: ${ownerApplied.body.error}`,
);
const appliedState = await state(applied);
check(appliedState.appliedAt !== null && appliedState.discardedAt === null && (await discardEvents(applied)) === 0, "   it stays applied, not discarded");

heading("A. The project's owner");
const asAlice = await discard(forOwner, { viewer: ALICE });
check(asAlice.status === 200 && asAlice.body.ok === true, `Alice discards her pending revision: ${asAlice.status}`);
check((await state(forOwner)).discardedAt !== null && (await discardEvents(forOwner)) === 1, "   discardedAt is set and one scenario.revision_discarded event is recorded");
const again = await discard(forOwner, { viewer: ALICE });
check(again.status === 200 && (await discardEvents(forOwner)) === 1, "   discarding again is still 200 and records nothing new");

heading("Sign-in switched off on the server");
const noAuth = await discard(forNoAuth, { enabled: false, viewer: null });
check(noAuth.status === 200 && (await state(forNoAuth)).discardedAt !== null, "every project is reachable, as before accounts existed (200, discarded)");

heading("D. The reference example: any signed-in user may discard on it, a signed-out viewer may not");
await db.update(projects).set({ slug: laptopAdvisor.slug, ownerId: null }).where(eq(projects.id, projectId));
const exampleBob = await discard(forExampleBob, { viewer: BOB });
check(exampleBob.status === 200 && (await state(forExampleBob)).discardedAt !== null, "any signed-in user may discard a draft on the example (200)");
const exampleSignedOut = await discard(forExampleSignedOut, { viewer: null });
check(exampleSignedOut.status === 401, `a signed-out viewer is asked to sign in (401): ${exampleSignedOut.body.error}`);
check(await untouched(forExampleSignedOut), "   the draft is untouched: no discardedAt, no scenario.revision_discarded event");

heading("Isolation");
check(kind === "pglite", `ran on the in-process database (${kind}), not DATABASE_URL`);
check(network.length === 0, `no network call was attempted${network.length ? `: ${network.join(", ")}` : ""}`);

heading("Result");
if (problems.length) {
  console.log(c.red(`${problems.length} check(s) failed.`));
  process.exitCode = 1;
} else {
  console.log(c.green("Scenario revision discard authorization: all checks passed."));
}
