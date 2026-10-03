import type { Assertion } from "./schemas";

/** Pure formatting helpers, safe to import from client components. */

export function describeAssertion(a: Assertion): string {
  if (a.type === "judge") return `judge ${a.agent}: "${a.criterion}"`;
  const subject = a.type === "tool" ? `tool ${a.tool}${a.agent ? `@${a.agent}` : ""} ${a.path}` : `output ${a.agent}.${a.path}`;
  const value = a.op === "exists" || a.op === "is_null" ? "" : ` ${JSON.stringify(a.value)}`;
  const match = a.type === "tool" && a.path !== "count" ? ` (${a.match})` : "";
  return `${subject} ${a.op}${value}${match}`;
}

/** "recommendation-agent" → "Recommendation Agent": agent keys are derived from their names, so this reads back. */
const agentLabel = (key: string) =>
  key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

function comparison(a: Exclude<Assertion, { type: "judge" }>): string {
  const value = typeof a.value === "string" ? a.value : JSON.stringify(a.value);
  switch (a.op) {
    case "exists":
      return "is set";
    case "is_null":
      return "is empty";
    case "eq":
      return `is ${value}`;
    case "neq":
      return `is not ${value}`;
    case "lte":
      return `is at most ${value}`;
    case "gte":
      return `is at least ${value}`;
    case "contains":
      return `contains ${value}`;
  }
}

/**
 * The same check as `describeAssertion`, in the words the owner would use. The exact form stays available next to
 * it: a scenario has a plain-language face and a precise one, and neither replaces the other.
 */
export function describeAssertionPlainly(a: Assertion): string {
  if (a.type === "judge") return a.criterion;
  if (a.type === "output") return `${agentLabel(a.agent)}: ${a.path} ${comparison(a)}`;
  const subject =
    a.path === "count" ? "result count" : a.path.replace(/^args\./, "").replace(/^result\./, "");
  const scope = a.path === "count" ? "" : a.match === "all" ? " (in every call)" : " (in at least one call)";
  return `${a.tool}: ${subject} ${comparison(a)}${scope}`;
}

/** Non-empty trimmed lines removed from / added to a text, order preserved. */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const lines = (t: string) =>
    t
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const a = lines(before);
  const b = lines(after);
  return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}
