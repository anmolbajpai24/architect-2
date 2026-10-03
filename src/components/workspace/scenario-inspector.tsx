import { GitPullRequestArrow, History, MessageSquare, ShieldCheck, Sparkles, Store, Wrench } from "lucide-react";
import type { ScenarioResult } from "@/domain/schemas";
import type { ScenarioVersionStatus, WorkspaceAgent, WorkspaceChange, WorkspaceScenario } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { AssertionRow } from "./assertion-row";
import { modelLabel, shortId } from "./format";
import { JsonBlock } from "./json-block";
import { RelativeTime } from "./relative-time";
import { ScenarioRevisionDiff } from "./scenario-revision-diff";
import { StatusIcon, statusLabel } from "./status";
import type { DisplayStatus } from "./use-workspace";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

export function Reply({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Store className="size-3.5" />
      </div>
      <div className="rounded-xl rounded-tl-sm border bg-background px-3 py-2 text-[13px] leading-relaxed">{text}</div>
    </div>
  );
}

export function ScenarioInspector({
  scenario,
  status,
  result,
  runLabel,
  agents,
  changes,
  onOpenChange,
}: {
  scenario: WorkspaceScenario;
  status: DisplayStatus;
  result: ScenarioResult | undefined;
  runLabel: string;
  agents: WorkspaceAgent[];
  changes: WorkspaceChange[];
  onOpenChange: (id: string) => void;
}) {
  // A result only lines up with these assertions if it was judged against this version of the rule.
  const judgedVersion = result?.scenarioVersion;
  const sameRule = !result?.scenarioVersionId || result.scenarioVersionId === scenario.versionId;
  const reply = (result?.trace.agents["store-advisor"]?.output as { reply?: string } | undefined)?.reply;
  const agentName = (key: string) => agents.find((a) => a.key === key)?.name ?? key;
  const traceAgents = result ? Object.values(result.trace.agents) : [];

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} className="size-5" />
          <h3 className="text-base font-semibold leading-tight">{scenario.name}</h3>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10.5px] text-emerald-700">
            v{scenario.version}
          </span>
        </div>
        <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs leading-snug text-emerald-900">
          <ShieldCheck className="size-4 shrink-0" />
          <div>
            <div className="font-medium">Protects</div>
            {scenario.intent}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {statusLabel(status)} · {runLabel}
        </p>
      </header>

      <Section title="Customer says">
        <div className="flex justify-end">
          <div className="flex max-w-[90%] gap-2 rounded-xl rounded-tr-sm bg-foreground px-3 py-2 text-[13px] leading-relaxed text-background">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 opacity-60" />
            {scenario.input.message}
          </div>
        </div>
        {reply && <Reply text={reply} />}
      </Section>

      <Section title={`Assertions (${scenario.assertions.length})`}>
        <div className="-mx-1 space-y-0.5">
          {scenario.assertions.map((a, i) => (
            <AssertionRow key={i} assertion={a} result={sameRule ? result?.assertions[i] : undefined} />
          ))}
        </div>
        {!sameRule && (
          <p className="text-[11px] text-amber-700">
            The latest run judged v{judgedVersion} of this rule, so its results aren&apos;t shown against v{scenario.version}.
          </p>
        )}
      </Section>

      <Section title="Trace">
        {!result ? (
          <p className="text-xs text-muted-foreground">No trace yet. Run the scenarios to see what each agent did.</p>
        ) : (
          <div className="space-y-2">
            {result.trace.error && (
              <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">Runtime error: {result.trace.error}</p>
            )}
            {traceAgents.map((t) => (
              <details key={t.agent} className="group rounded-lg border bg-background">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
                  <span className="flex-1">{agentName(t.agent)}</span>
                  {t.toolCalls.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                      <Wrench className="size-3" />
                      {t.toolCalls.length} tool call{t.toolCalls.length > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                </summary>
                <div className="space-y-2 border-t px-3 py-2.5">
                  {t.toolCalls.map((c, i) => {
                    const items = (c.result as { items?: { sku: string }[] } | null)?.items ?? [];
                    return (
                      <div key={i} className="rounded-md bg-violet-50/60 p-2 font-mono text-[11px] leading-relaxed">
                        <div className="text-violet-800">
                          {c.tool}({JSON.stringify(c.args)})
                        </div>
                        <div className="text-muted-foreground">
                          → {items.length} result{items.length === 1 ? "" : "s"}
                          {items.length > 0 && `: ${items.map((x) => x.sku).join(", ")}`}
                        </div>
                      </div>
                    );
                  })}
                  <JsonBlock value={t.output} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>

      <RuleHistory scenario={scenario} changes={changes} onOpenChange={onOpenChange} />
    </div>
  );
}

const versionTone: Record<ScenarioVersionStatus, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-700",
  proposed: "border-indigo-200 bg-indigo-50 text-indigo-700",
  superseded: "border-border bg-muted text-muted-foreground",
  discarded: "border-border bg-background text-muted-foreground line-through",
};

/** Every version of the rule, with who asked for it and why. Older versions stay readable and diffable. */
function RuleHistory({
  scenario,
  changes,
  onOpenChange,
}: {
  scenario: WorkspaceScenario;
  changes: WorkspaceChange[];
  onOpenChange: (id: string) => void;
}) {
  return (
    <Section title={`Rule history (${scenario.versions.length})`}>
      <div className="space-y-2">
        {scenario.versions.map((v) => {
          const base = scenario.versions.find((x) => x.id === v.basedOnVersionId);
          const change = changes.find((c) => c.id === v.changeId);
          return (
            <div key={v.id} className="rounded-xl border bg-background p-3">
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[10.5px]", versionTone[v.status])}>
                  v{v.version} · {v.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{v.name}</span>
                <RelativeTime iso={v.createdAt} className="text-[11px] text-muted-foreground" />
              </div>
              {v.request ? (
                <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground">
                  <History className="mr-1 inline size-3" />
                  Changed at your request: “{v.request}”
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Seeded baseline rule.</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {change && (
                  <button type="button" onClick={() => onOpenChange(change.id)} className="inline-flex items-center gap-1 hover:text-foreground">
                    <GitPullRequestArrow className="size-3" /> from blocked change #{shortId(change.id)}
                  </button>
                )}
                {v.proposal && (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="size-3" /> drafted by {v.proposal.mode === "live" ? modelLabel(v.proposal.model) : "fixture proposer"}
                  </span>
                )}
              </div>
              {base && (
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground">
                    <span className="inline-block transition-transform group-open:rotate-90">›</span> Compare with v{base.version}
                  </summary>
                  <div className="mt-2">
                    <ScenarioRevisionDiff before={base} after={v} />
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
