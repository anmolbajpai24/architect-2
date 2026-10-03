import { describeAssertion } from "@/domain/format";
import type { Assertion, AssertionResult } from "@/domain/schemas";
import { cn } from "@/lib/utils";
import { formatValue } from "./format";
import { StatusIcon } from "./status";

const typeTone: Record<Assertion["type"], string> = {
  tool: "bg-violet-50 text-violet-700 border-violet-200",
  output: "bg-sky-50 text-sky-700 border-sky-200",
  judge: "bg-amber-50 text-amber-700 border-amber-200",
};

export function AssertionRow({ assertion, result }: { assertion: Assertion; result?: AssertionResult }) {
  const failed = result?.status === "fail" || result?.status === "error";
  return (
    <div className={cn("flex gap-2.5 rounded-lg px-2.5 py-2", failed && "bg-rose-50")}>
      <StatusIcon status={result?.status ?? "idle"} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className={cn("mt-px rounded border px-1.5 text-[10px] font-medium uppercase", typeTone[assertion.type])}>
            {assertion.type}
          </span>
          <span className="min-w-0 text-xs leading-snug">
            {assertion.type === "judge" ? assertion.criterion : (assertion.description ?? describeAssertion(assertion))}
          </span>
        </div>
        {assertion.type !== "judge" && assertion.description && (
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">{describeAssertion(assertion)}</div>
        )}
        {result && failed && (
          <div className="mt-1 font-mono text-[11px] text-rose-700">
            {result.reason ?? `actual: ${formatValue(result.actual)}`}
          </div>
        )}
        {result?.status === "skipped" && <div className="mt-1 text-[11px] text-amber-700">Skipped: {result.reason}</div>}
        {result?.status === "pass" && assertion.type === "judge" && result.reason && (
          <div className="mt-1 text-[11px] text-muted-foreground">{result.reason}</div>
        )}
      </div>
    </div>
  );
}
