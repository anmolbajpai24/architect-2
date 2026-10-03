import type { WorkspaceEvent, WorkspaceSnapshot } from "@/server/workspace";

export const shortId = (id: string) => id.slice(0, 6);

export const modelLabel = (spec: string) => spec.split(":").slice(1).join(":") || spec;

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return `"${value}"`;
  return JSON.stringify(value);
}

export type EnvSummary = {
  mode: "demo" | "live";
  label: string;
  /** One plain-language sentence for the header indicator's tooltip. */
  summary: string;
  /** Whether the user can ask for arbitrary changes, or only the scripted demo request. */
  freeFormChanges: boolean;
};

/**
 * The one product-level fact about this server's configuration: is it the self-contained offline demo, or is it
 * wired to real models? Everything more specific lives in the Environment popover.
 */
export function envSummary(env: WorkspaceSnapshot["env"]): EnvSummary {
  const demo = env.proposer.mode === "fixture" || env.mode === "fixture";
  return {
    mode: demo ? "demo" : "live",
    label: demo ? "Demo mode" : "Live mode",
    summary: demo
      ? "This workspace runs on recorded models so the demo reproduces exactly. Open Environment for details."
      : "This workspace is connected to real models. Open Environment for details.",
    freeFormChanges: env.proposer.mode === "live",
  };
}

/** Server messages that are really about this server's configuration, not about the user's request. */
const CONFIG_LIMIT = /fixture proposer|ANTHROPIC_API_KEY|OPENAI_API_KEY|ARCHITECT_[A-Z_]+|DATABASE_URL/;
const RULE_LIMIT = /scripted rule change|change other rules/;

/**
 * Turns a server error into product language. Configuration limits of the offline demo are a product state
 * ("not enabled here"), not a developer error, so they never show environment variables or shell commands —
 * those stay in the Environment popover.
 */
export function friendlyError(message: string): { title: string; detail: string | null } {
  if (CONFIG_LIMIT.test(message)) {
    return RULE_LIMIT.test(message)
      ? {
          title: "Free-form rule changes aren't enabled in Demo mode.",
          detail: "Connect a model to rewrite any requirement. The suggested rule change below works offline.",
        }
      : {
          title: "Free-form changes aren't enabled in Demo mode.",
          detail: "Connect a model to ask Architect for arbitrary changes. The suggested request works offline.",
        };
  }
  return { title: message, detail: null };
}

/** One line per event for the activity feed; null hides high-volume detail events. */
export function describeEvent(e: WorkspaceEvent, snapshot: WorkspaceSnapshot): { text: string; tone: "default" | "good" | "bad" | "muted" } | null {
  const p = e.payload;
  const scenarioName = (key: unknown) => snapshot.scenarios.find((s) => s.key === key)?.name ?? String(key);
  switch (e.type) {
    case "project.seeded": {
      // The counts are the project's own, so they come from the seed event rather than from this line.
      const agents = typeof p.agents === "number" ? `${p.agents} agent${p.agents === 1 ? "" : "s"} at v1` : null;
      const scenarios = typeof p.scenarios === "number" ? `${p.scenarios} scenario${p.scenarios === 1 ? "" : "s"}` : null;
      const counts = [agents, scenarios].filter(Boolean).join(", ");
      return { text: counts ? `Project seeded: ${counts}` : "Project seeded", tone: "muted" };
    }
    case "project.created": {
      const agents = typeof p.agents === "number" ? `${p.agents} agent${p.agents === 1 ? "" : "s"}` : null;
      const scenarios = typeof p.scenarios === "number" ? `${p.scenarios} scenario${p.scenarios === 1 ? "" : "s"}` : null;
      const counts = [agents, scenarios].filter(Boolean).join(" and ");
      return { text: counts ? `Project created from your brief: ${counts}` : "Project created from your brief", tone: "muted" };
    }
    case "change.drafting":
      return {
        text: p.fix ? "Architect is drafting a fix that keeps the rule" : `Architect is drafting a change: “${p.intent}”`,
        tone: "muted",
      };
    case "change.draft_failed":
      return { text: `No change drafted: ${friendlyError(String(p.message)).title}`, tone: "bad" };
    case "change.created":
      return { text: `Change proposed: “${p.intent}”`, tone: "default" };
    case "change.structural_checked":
      return p.ok
        ? { text: "Structural verification passed", tone: "good" }
        : { text: "Structural verification failed", tone: "bad" };
    case "run.started":
      return { text: e.changeId ? "Running scenarios against the proposed versions" : "Running scenarios against the live agents", tone: "muted" };
    case "scenario.finished":
      return p.status === "pass" ? null : { text: `${scenarioName(p.scenario)} failed`, tone: "bad" };
    case "run.finished":
      return {
        text: `Run ${p.status}: ${p.passed}/${p.total} scenarios passing`,
        tone: p.status === "passed" ? "good" : "bad",
      };
    case "change.behavioral_failed":
      return { text: "Change blocked: it breaks a protected behavior", tone: "bad" };
    case "change.verified":
      return { text: "Change verified: safe to apply", tone: "good" };
    case "change.resolved":
      return p.resolution === "change_rule"
        ? { text: "Resolution chosen: Change the rule (the change is re-verified under the new rule)", tone: "default" }
        : { text: "Resolution chosen: Keep the rule → Fix it", tone: "default" };
    case "scenario.revision_drafting":
      return { text: `Architect is drafting a rule change for ${scenarioName(p.scenario)}: “${p.request}”`, tone: "muted" };
    case "scenario.revision_draft_failed":
      return { text: `No rule change drafted: ${friendlyError(String(p.message)).title}`, tone: "bad" };
    case "scenario.revision_proposed":
      return { text: `Rule change drafted for ${scenarioName(p.scenario)} (v${p.version}), awaiting your review`, tone: "default" };
    case "scenario.revision_discarded":
      return { text: `Rule change draft v${p.version} for ${scenarioName(p.scenario)} discarded`, tone: "muted" };
    case "scenario.revised":
      return { text: `Rule changed: ${scenarioName(p.scenario)} v${p.fromVersion} → v${p.toVersion}`, tone: "default" };
    case "change.applied":
      return { text: "Change applied to the live agents", tone: "good" };
    case "change.shipping":
      return { text: `Shipping to GitHub: opening a pull request on ${p.repository}`, tone: "muted" };
    case "change.shipped":
      return { text: `Shipped to GitHub: PR #${p.prNumber} on ${p.repository}`, tone: "good" };
    case "change.ship_failed":
      return { text: `Shipping to GitHub failed (${p.step}): ${p.message}`, tone: "bad" };
    case "job.failed":
      return { text: `${p.job} failed: ${p.message}`, tone: "bad" };
    default:
      return null;
  }
}
