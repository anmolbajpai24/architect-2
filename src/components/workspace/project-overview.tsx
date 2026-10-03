import { Bot, FlaskConical, ShieldCheck } from "lucide-react";
import type { WorkspaceRun, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./status";
import { protectionSummary, scenarioStatus, type Progress } from "./use-workspace";

function Count({ icon: Icon, n, label }: { icon: typeof Bot; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="font-medium tabular-nums">{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * What the user sees before they have picked anything: the project, and the behaviors Architect is protecting,
 * stated as the owner stated them. Opening a scenario replaces this with that scenario's detail.
 */
export function ProjectOverview({
  snapshot,
  latestRun,
  progress,
  onSelectScenario,
}: {
  snapshot: WorkspaceSnapshot;
  latestRun: WorkspaceRun | undefined;
  progress: Progress | null;
  onSelectScenario: (key: string) => void;
}) {
  const statuses = snapshot.scenarios.map((s) => scenarioStatus(s.key, latestRun, progress));
  const { total, passing, failing, notRun } = protectionSummary(snapshot.scenarios, latestRun, progress);

  const verdict = notRun
    ? { tone: "idle" as const, headline: `${total} scenarios, not verified yet`, body: "Run the scenarios to see how the agents behave right now." }
    : failing > 0
      ? {
          tone: "bad" as const,
          headline: `${failing} of ${total} scenarios failing`,
          body: "The live agents don't meet every behavior you protect.",
        }
      : passing === total
        ? { tone: "good" as const, headline: `All ${total} scenarios pass`, body: "The live agents meet every behavior you protect." }
        : { tone: "idle" as const, headline: `${passing} of ${total} scenarios passing`, body: "Verification is still in progress." };

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h3 className="text-base font-semibold leading-tight">{snapshot.project.name}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Count icon={Bot} n={snapshot.agents.length} label="agents" />
          <Count icon={FlaskConical} n={total} label="scenarios" />
        </div>
      </header>

      <div
        className={cn(
          "rounded-xl border p-3",
          verdict.tone === "good" && "border-emerald-200 bg-emerald-50/60",
          verdict.tone === "bad" && "border-rose-200 bg-rose-50/60",
          verdict.tone === "idle" && "bg-muted/40",
        )}
      >
        <div
          className={cn(
            "text-sm font-semibold",
            verdict.tone === "good" && "text-emerald-900",
            verdict.tone === "bad" && "text-rose-900",
          )}
        >
          {verdict.headline}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{verdict.body}</p>
      </div>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          What Architect protects
        </h4>
        <div className="flex flex-col gap-1.5">
          {snapshot.scenarios.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectScenario(s.key)}
              className="flex w-full items-start gap-2 rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <StatusIcon status={statuses[i]} className="mt-0.5 size-3.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium leading-snug">{s.name}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{s.intent}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Ask Architect for a change and it is verified against every one of these before anything goes live. Open a
        scenario to see the example it runs, or an agent to see its configuration.
      </p>
    </div>
  );
}
