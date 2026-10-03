"use client";

import { useState } from "react";
import { Boxes, LoaderCircle, MousePointerClick, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceSnapshot } from "@/server/workspace";
import { AgentInspector } from "./agent-inspector";
import { AgentSystem } from "./agent-system";
import { ChangesPanel } from "./changes-panel";
import { modelLabel, shortId } from "./format";
import { ScenarioInspector } from "./scenario-inspector";
import { ScenarioStrip, type StripContext } from "./scenario-strip";
import { scenarioStatus, streamingProgress, useWorkspace } from "./use-workspace";
import { VerdictDrawer } from "./verdict-drawer";

type Selection = { kind: "scenario" | "agent"; key: string } | null;

function EnvBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}

function Column({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
    </div>
  );
}

export function Workspace({ initial, initialChangeId = null }: { initial: WorkspaceSnapshot; initialChangeId?: string | null }) {
  const api = useWorkspace(initial);
  const { snapshot, events, progress } = api;
  const [selection, setSelection] = useState<Selection>({ kind: "scenario", key: initial.scenarios[0]?.key });
  const [openChangeId, setOpenChangeId] = useState<string | null>(initialChangeId);

  const latestRun = snapshot.runs[0];
  const streaming = streamingProgress(latestRun, progress);
  const contextChange = (streaming ? streaming.changeId : latestRun?.changeId) ?? null;
  const context: StripContext = streaming
    ? {
        tone: "running",
        text: contextChange ? `Verifying change #${shortId(contextChange)} against proposed versions…` : "Running against the live agents…",
      }
    : !latestRun
      ? { tone: "none", text: "Not run yet" }
      : contextChange
        ? { tone: "proposed", text: `Showing proposed change #${shortId(contextChange)} · not live` }
        : { tone: "live", text: "Live agents" };

  const selectedScenario = selection?.kind === "scenario" ? snapshot.scenarios.find((s) => s.key === selection.key) : undefined;
  const selectedAgent = selection?.kind === "agent" ? snapshot.agents.find((a) => a.key === selection.key) : undefined;

  const propose = async (intent: string) => {
    const res = await api.proposeChange(intent);
    if (res?.changeId) setOpenChangeId(res.changeId);
    return Boolean(res);
  };

  return (
    <div className="flex h-dvh flex-col bg-muted/30 text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="size-4" />
          </div>
          <span className="text-sm font-semibold">Architect</span>
        </div>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-sm font-medium">{snapshot.project.name}</span>
        <div className="ml-2 hidden items-center gap-1.5 md:flex">
          <EnvBadge
            label={snapshot.env.db === "pglite" ? "pglite" : "supabase"}
            hint={snapshot.env.db === "pglite" ? "In-process Postgres; data resets when the server restarts. Set DATABASE_URL for Supabase." : "Supabase Postgres via DATABASE_URL."}
          />
          <EnvBadge
            label={`proposer: ${snapshot.env.proposer.mode === "live" ? modelLabel(snapshot.env.proposer.model) : "fixture"}`}
            hint={
              snapshot.env.proposer.mode === "live"
                ? `Architect drafts changes with ${snapshot.env.proposer.model}. Every draft is still verified before it can go live.`
                : "Offline fixture proposer: replays the recorded edits for the scripted demo request only. Set ANTHROPIC_API_KEY (or ARCHITECT_PROPOSER=live) to draft any change."
            }
          />
          <EnvBadge
            label={`${snapshot.env.mode} models`}
            hint={snapshot.env.mode === "fixture" ? "Agents run on the deterministic fixture model so the demo reproduces exactly. Set ARCHITECT_MODEL_MODE=live for real models." : "Agents run on the provider models in their configs."}
          />
          <EnvBadge
            label={snapshot.env.github.configured ? `github: ${snapshot.env.github.repositories.join(", ")}` : "github off"}
            hint={
              snapshot.env.github.configured
                ? "Verified, applied changes can be shipped as pull requests to these repositories. The GitHub credential stays on the server."
                : `Shipping to GitHub is off: ${snapshot.env.github.problems.join("; ")}. Everything else works without it.`
            }
          />
          <EnvBadge
            label={`judge ${snapshot.env.judge === "live" ? "on" : "off"}`}
            hint={snapshot.env.judge === "live" ? "Judge assertions run on JUDGE_MODEL." : "Judge assertions are skipped; tool and output assertions decide pass/fail. Set ARCHITECT_JUDGE=live to enable."}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {api.busyLabel && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {api.busyLabel}…
            </span>
          )}
          <Button variant="ghost" size="sm" disabled={api.busy} onClick={() => { setOpenChangeId(null); api.reset(); }}>
            <RotateCcw data-icon="inline-start" /> Reset demo
          </Button>
          <Button size="sm" disabled={api.busy} onClick={() => api.runScenarios()}>
            <Play data-icon="inline-start" /> Run scenarios
          </Button>
        </div>
      </header>

      <ScenarioStrip
        scenarios={snapshot.scenarios}
        latestRun={latestRun}
        progress={progress}
        context={context}
        selectedKey={selection?.kind === "scenario" ? selection.key : null}
        onSelect={(key) => setSelection({ kind: "scenario", key })}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(380px,440px)]">
        <Column title="Agent system" className="border-r">
          <AgentSystem
            agents={snapshot.agents}
            selectedKey={selection?.kind === "agent" ? selection.key : null}
            onSelect={(key) => setSelection({ kind: "agent", key })}
          />
        </Column>

        <Column title="Ask Architect">
          <ChangesPanel
            snapshot={snapshot}
            events={events}
            busy={api.busy}
            drafting={api.busyLabel === "Drafting change"}
            openChangeId={openChangeId}
            onPropose={propose}
            onOpenChange={setOpenChangeId}
          />
        </Column>

        <Column title="Inspector" className="border-l bg-background">
          {selectedScenario ? (
            <ScenarioInspector
              scenario={selectedScenario}
              status={scenarioStatus(selectedScenario.key, latestRun, progress)}
              result={streaming ? undefined : latestRun?.results?.find((r) => r.scenarioKey === selectedScenario.key)}
              runLabel={context.text}
              agents={snapshot.agents}
              changes={snapshot.changes}
              onOpenChange={setOpenChangeId}
            />
          ) : selectedAgent ? (
            <AgentInspector agent={selectedAgent} snapshot={snapshot} onOpenChange={setOpenChangeId} />
          ) : (
            <div className="flex flex-col items-center gap-2 pt-16 text-center text-xs text-muted-foreground">
              <MousePointerClick className="size-5" />
              Select a scenario or an agent to inspect it.
            </div>
          )}
        </Column>
      </main>

      <VerdictDrawer
        changeId={openChangeId}
        snapshot={snapshot}
        progress={progress}
        api={api}
        onOpenChange={setOpenChangeId}
        onClose={() => setOpenChangeId(null)}
      />

      {api.error && (
        <div role="alert" className="fixed bottom-4 left-4 z-50 flex max-w-md items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 shadow-lg">
          <span className="flex-1 leading-relaxed">{api.error}</span>
          <button type="button" onClick={api.dismissError} aria-label="Dismiss" className="text-rose-500 hover:text-rose-700">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
