import { ShieldCheck } from "lucide-react";
import type { WorkspaceRun, WorkspaceScenario } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { StatusIcon, statusLabel } from "./status";
import { scenarioStatus, streamingProgress, type Progress } from "./use-workspace";

export type StripContext = { tone: "live" | "proposed" | "running" | "none"; text: string };

const cardTone = {
  pass: "border-emerald-200 bg-emerald-50/40",
  fail: "border-rose-300 bg-rose-50/60",
  error: "border-rose-300 bg-rose-50/60",
  running: "border-sky-200 bg-sky-50/40",
  queued: "border-border bg-background",
  idle: "border-border bg-background",
};

const dotTone = {
  pass: "bg-emerald-500",
  fail: "bg-rose-500",
  error: "bg-rose-500",
  skipped: "bg-amber-400",
};

const labelTone: Record<string, string> = {
  pass: "text-emerald-700",
  fail: "text-rose-700",
  error: "text-rose-700",
  running: "text-sky-700",
  queued: "text-muted-foreground",
  idle: "text-muted-foreground",
};

const contextTone = {
  live: "bg-emerald-50 text-emerald-700 border-emerald-200",
  proposed: "bg-sky-50 text-sky-700 border-sky-200",
  running: "bg-sky-50 text-sky-700 border-sky-200",
  none: "bg-muted text-muted-foreground border-border",
};

export function ScenarioStrip({
  scenarios,
  latestRun,
  progress,
  context,
  selectedKey,
  onSelect,
}: {
  scenarios: WorkspaceScenario[];
  latestRun: WorkspaceRun | undefined;
  progress: Progress | null;
  context: StripContext;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const statuses = scenarios.map((s) => scenarioStatus(s.key, latestRun, progress));
  const passing = statuses.filter((s) => s === "pass").length;
  const streaming = streamingProgress(latestRun, progress);

  return (
    <section className="border-b bg-background px-5 py-3">
      <div className="mb-2.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Scenarios
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {passing}/{scenarios.length} passing
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", contextTone[context.tone])}>
          {context.text}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {scenarios.map((s, i) => {
          const status = statuses[i];
          const result = latestRun?.results?.find((r) => r.scenarioKey === s.key);
          const shown = streaming ? undefined : result;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              className={cn(
                "group flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-all hover:shadow-sm",
                cardTone[status],
                selectedKey === s.key && "ring-2 ring-foreground/80 ring-offset-1",
              )}
            >
              <div className="flex items-start gap-2">
                <StatusIcon status={status} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium leading-snug">{s.name}</span>
                    {s.version > 1 && (
                      <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 font-mono text-[10px] text-indigo-700">
                        v{s.version} · rule changed
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{s.intent}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pl-6">
                <span className={cn("text-[11px] font-medium", labelTone[status])}>{statusLabel(status)}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {shown && (
                    <span className="flex gap-0.5" aria-hidden>
                      {shown.assertions.map((a, j) => (
                        <span key={j} className={cn("h-1 w-2.5 rounded-full", dotTone[a.status])} />
                      ))}
                    </span>
                  )}
                  {s.assertions.length} checks
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
