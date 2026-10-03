/**
 * pnpm ship:check
 * Deterministic coverage for "Ship to GitHub": the server-side ship gate, branch → commit → pull request against an
 * in-memory fake GitHub (through the real REST provider), stored provenance, duplicate-ship safety, and failures
 * recorded as events. Never touches the real GitHub. Exits non-zero if any check fails. --print shows the PR and files.
 */
import { and, eq } from "drizzle-orm";
import { applyChange, keepRuleAndFix, loadBlockedChangeContext, proposeChange, verifyChange } from "@/changes/change";
import { draftChange, draftFix, proposerConfig, type ProposerConfig } from "@/changes/proposer";
import { openDb } from "@/db/client";
import { changeShipments, events } from "@/db/schema";
import { REGRESSION_INTENT } from "@/fixtures/regression";
import { githubStatus } from "@/github/config";
import { createGitHubRestProvider } from "@/github/provider";
import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { laptopAdvisor } from "@/demo/project";
import { toProjectRuntime } from "@/projects/registry";
import { getWorkspace } from "@/server/workspace";
import { branchFor } from "@/shipping/artifact";
import { shipChange, ShipError, type ShipInput } from "@/shipping/ship";
import { createFakeGitHub } from "./fake-github";
import { c, heading } from "./report";

const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? c.green("  ✔") : c.red("  ✘")} ${what}`);
  if (!ok) problems.push(what);
};
async function rejects(p: Promise<unknown>, status: number, what: string) {
  try {
    await p;
    check(false, `${what} (was not rejected)`);
  } catch (err) {
    const got = err instanceof ShipError ? err.status : `${err}`;
    check(got === status, `${what} → ${got}${err instanceof ShipError ? `: ${err.message}` : ""}`);
  }
}

const TOKEN = "ghp_fake_token_for_tests_only";
const REPO = "acme/laptop-advisor-agents";
const fake = createFakeGitHub({ token: TOKEN, repos: [REPO, "acme/other"] });
const env = { ARCHITECT_GITHUB_TOKEN: TOKEN, ARCHITECT_GITHUB_REPOS: `${REPO}, acme/other` };
const github: ShipInput["github"] = {
  status: githubStatus(env),
  provider: createGitHubRestProvider({ getToken: async () => TOKEN, fetch: fake.fetch }),
};
const opts = { mode: "fixture" as const, judge: "skip" as const, runtime: toProjectRuntime(laptopAdvisor) };
const proposer: ProposerConfig = { mode: "fixture", model: proposerConfig().model };

const { db, close } = await openDb();
try {
  const projectId = await laptopAdvisor.seed(db, { reset: true });
  const ship = (changeId: string, extra: Partial<ShipInput> = {}) => shipChange(db, { changeId, github, publicUrl: null, ...extra });
  const shipEvents = async (changeId: string, type: string) =>
    db.select().from(events).where(and(eq(events.changeId, changeId), eq(events.type, type)));

  heading("Gate: a change that failed behavioral verification");
  const draft = await draftChange({
    intent: REGRESSION_INTENT,
    versions: await loadCurrentVersions(db, projectId),
    runtime: opts.runtime,
    config: proposer,
  });
  const persuasive = await proposeChange(db, { projectId, intent: REGRESSION_INTENT, edits: draft.edits, proposal: draft.proposal });
  const blocked = await verifyChange(db, persuasive.id, opts);
  check(blocked.change.status === "behavioral_failed", "the persuasive change is blocked by a scenario");
  await rejects(ship(persuasive.id), 409, "1. ship is rejected when verification failed");

  heading("Gate: a verified change that isn't applied");
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
  const verified = await verifyChange(db, fix.id, opts);
  check(verified.change.status === "verified", "the fix is verified");
  await rejects(ship(fix.id), 409, "2. ship is rejected when the change is not applied");

  heading("Gate: applied, but scenarios haven't re-run on the live agents");
  await applyChange(db, fix.id);
  await rejects(ship(fix.id), 409, "ship is rejected until the live agents are re-verified");
  const liveRun = await runScenarios(db, { projectId, versions: await loadCurrentVersions(db, projectId), trigger: "manual", ...opts });
  check(liveRun.status === "passed", "live agents pass every scenario after apply");

  heading("Gate: GitHub configuration");
  const unconfigured = githubStatus({});
  check(!unconfigured.configured && unconfigured.problems.length === 2, `unconfigured status explains itself: ${unconfigured.problems.join("; ")}`);
  await rejects(ship(fix.id, { github: { status: unconfigured, provider: null } }), 503, "3. ship is rejected when GitHub is not configured");
  await rejects(ship(fix.id, { repository: "someone/else" }), 400, "ship is rejected for a repository outside the allowlist");
  check(fake.calls.length === 0, "no GitHub call was made by any rejected attempt");
  const snapshot = await getWorkspace(db, projectId, "pglite");
  const fixView = snapshot.changes.find((x) => x.id === fix.id);
  check(fixView?.ship?.ready === true && !fixView.shipment, "the workspace shows the applied change as ready to ship");
  check(snapshot.changes.find((x) => x.id === persuasive.id)?.ship === null, "the workspace offers no ship gate for the blocked change");
  check(!JSON.stringify(snapshot).includes(TOKEN), "the workspace snapshot (sent to the browser) doesn't contain the token");

  heading("GitHub failure while opening the pull request");
  const branch = branchFor(fix.id);
  fake.failNext({ method: "POST", path: /\/pulls$/, status: 500, message: "Server Error" });
  await rejects(ship(fix.id), 502, "a GitHub error surfaces as 502");
  const [failedRow] = await db.select().from(changeShipments).where(eq(changeShipments.changeId, fix.id));
  check(failedRow?.status === "failed" && Boolean(failedRow.error), `the shipment is recorded as failed: ${failedRow?.error}`);
  const failedEvents = await shipEvents(fix.id, "change.ship_failed");
  check(
    failedEvents.length === 1 && failedEvents[0].payload.step === "open the pull request",
    `9. the failure is recorded as a change.ship_failed event (step: ${failedEvents[0]?.payload.step})`,
  );
  const repo = fake.repo(REPO);
  check(repo.refs.has(branch), `4. branch ${branch} was created`);
  const mainSha = repo.refs.get("main")!;
  check(repo.commits.get(repo.refs.get(branch)!)?.parents[0] === mainSha, "   …from the default branch (main)");
  const files = fake.filesAt(REPO, branch)!;
  check(fake.commitsAhead(REPO, branch, "main").length === 1, "5. exactly one commit was made on the branch");
  const rec = JSON.parse(files.get("architect/agents/recommendation-agent.json") ?? "{}");
  check(rec.version === 3 && rec.instructions.join("\n").includes("set recommended_sku to null"), "   it commits Recommendation Agent v3 (the verified fix, honesty rule intact)");
  check(files.has(`architect/changes/${fix.id}.json`) && files.has("architect/scenarios/no-match-honesty.json"), "   plus the scenarios and the change's verification record");
  check(files.get("README.md") === `# ${REPO}\n`, "   existing repository files are kept");

  heading("Retry after the failure, with a double click");
  const callsBefore = fake.calls.length;
  const [a, b] = await Promise.allSettled([ship(fix.id), ship(fix.id)]);
  const ok = [a, b].filter((r) => r.status === "fulfilled");
  const rejected = [a, b].filter((r): r is PromiseRejectedResult => r.status === "rejected");
  check(
    ok.length === 1 && rejected.length === 1 && rejected[0].reason instanceof ShipError && rejected[0].reason.status === 409,
    `8. two concurrent ship requests: one ships, the other gets 409 (${rejected[0]?.reason?.message})`,
  );
  check(fake.commitsAhead(REPO, branch, "main").length === 1, "   the retry reused the branch and didn't add a duplicate commit");
  check(repo.pulls.length === 1, "6. exactly one pull request was opened");
  const pr = repo.pulls[0];
  check(pr?.number === 42 && pr.head === branch && pr.base === "main", `   PR #${pr?.number}: ${pr?.head} → ${pr?.base}`);
  check(pr?.title.startsWith(`Architect Change #${fix.id.slice(0, 6)}: `), `   title: "${pr?.title}"`);
  for (const phrase of ["Verified by Architect 2.0", "3/3 scenarios passing", "Structural verification | Passed", "only after the Architect change passed verification", "Prototype representation", "Keep the rule → Fix it"])
    check(Boolean(pr?.body.includes(phrase)), `   body mentions "${phrase}"`);

  if (process.argv.includes("--print")) {
    console.log(c.dim(`
--- PR #${pr?.number}: ${pr?.title}
${pr?.body}
--- commit files`));
    for (const [path, content] of files) console.log(c.dim(`
# ${path}
${content}`));
  }
  const [row] = await db.select().from(changeShipments).where(eq(changeShipments.changeId, fix.id));
  check(
    row.status === "shipped" &&
      row.repository === REPO &&
      row.branch === branch &&
      row.baseBranch === "main" &&
      row.commitSha === repo.refs.get(branch) &&
      row.prNumber === 42 &&
      row.prUrl === `https://github.com/${REPO}/pull/42` &&
      row.shippedAt instanceof Date &&
      row.runId === liveRun.id,
    "7. provenance stored against the change: repository, branch, commit SHA, PR number/URL, timestamp, run",
  );
  const shipped = await shipEvents(fix.id, "change.shipped");
  check(shipped.length === 1 && (shipped[0].payload.reused as { branch: boolean }).branch === true, "   one change.shipped event (branch reused from the failed attempt)");

  heading("Shipping again");
  const callsAfter = fake.calls.length;
  const again = await ship(fix.id);
  check(again.alreadyShipped && again.shipment.prNumber === 42, "8. a second ship returns the existing PR");
  check(fake.calls.length === callsAfter, "   without calling GitHub again");
  check(repo.pulls.length === 1 && repo.refs.size === 2, "   still one PR and one Architect branch");

  heading("Secrets");
  check(fake.calls.slice(callsBefore).every((x) => x.authorization === `Bearer ${TOKEN}`), "the token is only sent in the Authorization header to GitHub");
  const stored = JSON.stringify([await db.select().from(events).where(eq(events.projectId, projectId)), await db.select().from(changeShipments)]);
  const committed = JSON.stringify([...files.values(), pr?.body, pr?.title]);
  check(!stored.includes(TOKEN) && !committed.includes(TOKEN), "the token is not in events, shipments, committed files or the PR");
  const after = await getWorkspace(db, projectId, "pglite");
  const view = after.changes.find((x) => x.id === fix.id)?.shipment;
  check(view?.prNumber === 42 && view.branch === branch && !JSON.stringify(after).includes(TOKEN), "the workspace shows the PR and branch, never the token");

  heading("Result");
  if (problems.length) {
    console.log(c.red(`${problems.length} check(s) failed.`));
    process.exitCode = 1;
  } else {
    console.log(c.green("Ship to GitHub: all checks passed."));
  }
} finally {
  await close();
}
