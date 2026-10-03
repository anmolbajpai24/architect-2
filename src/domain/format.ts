import type { Assertion } from "./schemas";

/** Pure formatting helpers, safe to import from client components. */

export function describeAssertion(a: Assertion): string {
  if (a.type === "judge") return `judge ${a.agent}: "${a.criterion}"`;
  const subject = a.type === "tool" ? `tool ${a.tool}${a.agent ? `@${a.agent}` : ""} ${a.path}` : `output ${a.agent}.${a.path}`;
  const value = a.op === "exists" || a.op === "is_null" ? "" : ` ${JSON.stringify(a.value)}`;
  const match = a.type === "tool" && a.path !== "count" ? ` (${a.match})` : "";
  return `${subject} ${a.op}${value}${match}`;
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
