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

/** One line per event for the activity feed; null hides high-volume detail events. */
export function describeEvent(e: WorkspaceEvent, snapshot: WorkspaceSnapshot): { text: string; tone: "default" | "good" | "bad" | "muted" } | null {
  const p = e.payload;
  const scenarioName = (key: unknown) => snapshot.scenarios.find((s) => s.key === key)?.name ?? String(key);
  switch (e.type) {
    case "project.seeded":
      return { text: "Demo project seeded: 3 agents at v1, 3 scenarios", tone: "muted" };
    case "change.drafting":
      return {
        text: p.fix ? "Architect is drafting a fix that keeps the rule" : `Architect is drafting a change: “${p.intent}”`,
        tone: "muted",
      };
    case "change.draft_failed":
      return { text: `No change drafted: ${p.message}`, tone: "bad" };
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
      return { text: "Resolution chosen: Keep the rule → Fix it", tone: "default" };
    case "change.applied":
      return { text: "Change applied to the live agents", tone: "good" };
    case "job.failed":
      return { text: `${p.job} failed: ${p.message}`, tone: "bad" };
    default:
      return null;
  }
}
