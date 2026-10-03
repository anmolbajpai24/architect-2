import type { ChangeExplanation, StructuralCheck } from "@/db/schema";
import type { ScenarioResult } from "@/domain/schemas";
import type { ModelMode } from "@/runtime/models";
import { describeAssertion, type JudgeMode } from "@/scenarios/assertions";

const tty = process.stdout.isTTY;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { green: paint(32), red: paint(31), yellow: paint(33), dim: paint(2), bold: paint(1), cyan: paint(36) };

export function parseFlags(argv: string[]) {
  const live = argv.includes("--live");
  return {
    mode: (live ? "live" : "fixture") as ModelMode,
    judge: (live || argv.includes("--judge") ? "live" : "skip") as JudgeMode,
    reset: argv.includes("--reset"),
  };
}

export function heading(text: string) {
  console.log(`\n${c.bold(c.cyan(`== ${text}`))}`);
}

const mark = { pass: c.green("✓"), fail: c.red("✗"), error: c.red("!"), skipped: c.yellow("–") };

export function printRun(run: { id: string; status: string; modelMode: string; results: ScenarioResult[] }, judge: JudgeMode) {
  const passed = run.results.filter((r) => r.status === "pass").length;
  const status = run.status === "passed" ? c.green("PASSED") : c.red("FAILED");
  console.log(
    `Run ${run.id.slice(0, 8)} · ${run.modelMode} models · judge ${judge === "live" ? "live" : "skipped"} · ${status} ${passed}/${run.results.length} scenarios`,
  );
  for (const r of run.results) {
    const counts = r.assertions.reduce<Record<string, number>>((acc, a) => ((acc[a.status] = (acc[a.status] ?? 0) + 1), acc), {});
    const summary = Object.entries(counts)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");
    console.log(`  ${mark[r.status]} ${r.name} ${c.dim(`(${summary})`)}`);
    if (r.trace.error) console.log(`      ${c.red(`runtime error: ${r.trace.error}`)}`);
    const show = r.status === "pass" ? [] : r.assertions;
    for (const a of show) {
      const detail =
        a.status === "pass" || a.status === "skipped"
          ? a.reason ? c.dim(` (${a.reason})`) : ""
          : c.red(` → actual: ${a.reason ?? JSON.stringify(a.actual ?? null)}`);
      console.log(`      ${mark[a.status]} ${describeAssertion(a.assertion)}${detail}`);
    }
    if (r.status !== "pass") {
      const reply = finalReply(r.trace);
      if (reply) console.log(`      ${c.dim(`reply: "${reply}"`)}`);
    }
  }
}

/**
 * What the end user would have seen: the first text field of the final agent's output. The entry agent runs last,
 * so it is the last key in the trace. No agent or field is named, so this works for any project.
 */
function finalReply(trace: ScenarioResult["trace"]): string | undefined {
  const output = Object.values(trace.agents).at(-1)?.output;
  if (!output || typeof output !== "object") return undefined;
  const text = Object.values(output as Record<string, unknown>).find((v) => typeof v === "string" && v.trim() !== "");
  return typeof text === "string" ? text : undefined;
}

export function printStructural(checks: StructuralCheck[]) {
  const ok = checks.every((x) => x.ok);
  console.log(`Structural verification: ${ok ? c.green("PASSED") : c.red("FAILED")}`);
  for (const x of checks) console.log(`  ${x.ok ? mark.pass : mark.fail} ${x.check}: ${c.dim(x.message)}`);
}

export function printExplanation(e: ChangeExplanation) {
  console.log(c.bold("Why it failed:"));
  console.log(`  ${e.summary}`);
  for (const f of e.failures) {
    const label = f.assertion !== f.expected ? `${f.assertion}: ` : "";
    console.log(`  ${mark.fail} [${f.scenario}] ${label}expected ${f.expected}, got ${f.actual}`);
  }
  for (const d of e.instructionDiff) {
    console.log(`  Instruction diff for ${d.agent}:`);
    for (const l of d.removed) console.log(`    ${c.red(`- ${l}`)}`);
    for (const l of d.added) console.log(`    ${c.green(`+ ${l}`)}`);
  }
  console.log(`  Options: ${e.options.map((o) => `[${o.label}]`).join("  ")}`);
}
