import { MessageSquare, ShieldCheck, Store, Wrench } from "lucide-react";
import type { ScenarioResult } from "@/domain/schemas";
import type { WorkspaceAgent, WorkspaceScenario } from "@/server/workspace";
import { AssertionRow } from "./assertion-row";
import { JsonBlock } from "./json-block";
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
}: {
  scenario: WorkspaceScenario;
  status: DisplayStatus;
  result: ScenarioResult | undefined;
  runLabel: string;
  agents: WorkspaceAgent[];
}) {
  const reply = (result?.trace.agents["store-advisor"]?.output as { reply?: string } | undefined)?.reply;
  const agentName = (key: string) => agents.find((a) => a.key === key)?.name ?? key;
  const traceAgents = result ? Object.values(result.trace.agents) : [];

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} className="size-5" />
          <h3 className="text-base font-semibold leading-tight">{scenario.name}</h3>
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
            <AssertionRow key={i} assertion={a} result={result?.assertions[i]} />
          ))}
        </div>
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
    </div>
  );
}
