import type { Assertion, ToolResultSummary } from "./schemas";

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

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, value);
}

/** The first array found among a value's own fields, for results that declare no summary. */
function firstList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  return Object.values(value as Record<string, unknown>).find((v): v is unknown[] => Array.isArray(v));
}

function label(item: unknown, labelFields: string[]): string | undefined {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (!item || typeof item !== "object") return undefined;
  const row = item as Record<string, unknown>;
  const fields = labelFields.length > 0 ? labelFields : Object.keys(row);
  for (const field of fields) {
    const v = row[field];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/**
 * One line describing what a tool returned. Uses the tool's declared summary when the project provides one
 * (ToolDefinition.resultSummary), otherwise summarizes the first list it finds, and falls back to compact JSON
 * for results that are not list-shaped. No tool, field or domain is named here.
 */
export function summarizeToolResult(result: unknown, summary?: ToolResultSummary | null, max = 3): string {
  const items = summary ? at(result, summary.itemsPath) : firstList(result);
  const list = Array.isArray(items) ? items : undefined;
  if (!list) {
    if (result == null) return "no result";
    const json = JSON.stringify(result);
    return json === undefined ? "no result" : json.length > 120 ? `${json.slice(0, 117)}…` : json;
  }
  const count = `${list.length} result${list.length === 1 ? "" : "s"}`;
  const labels = list
    .slice(0, max)
    .map((item) => label(item, summary?.labelFields ?? []))
    .filter((l): l is string => Boolean(l));
  if (labels.length === 0) return count;
  const more = list.length > labels.length ? ", …" : "";
  return `${count}: ${labels.join(", ")}${more}`;
}
