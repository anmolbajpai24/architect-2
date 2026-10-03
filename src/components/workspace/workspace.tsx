"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, ExternalLink, LoaderCircle, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSnapshot } from "@/server/workspace";
import { AgentInspector } from "./agent-inspector";
import { AgentSystem } from "./agent-system";
import { ChangesPanel } from "./changes-panel";
import { EnvironmentButton } from "./environment";
import { friendlyError, shortId } from "./format";
import { ProjectOverview } from "./project-overview";
import { ScenarioInspector } from "./scenario-inspector";
import { ScenarioStrip, type StripContext } from "./scenario-strip";
import { protectionSummary, scenarioStatus, streamingProgress, useWorkspace } from "./use-workspace";
import { VerdictDrawer } from "./verdict-drawer";

type Selection = { kind: "scenario" | "agent"; key: string } | null;

function Column({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
    </div>
  );
}

/**
 * Server messages reach the user in product language: a limit of this server's configuration reads as a state of
 * the product ("not enabled here"), with the specifics kept in the Environment popover.
 */
function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { title, detail } = friendlyError(message);
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 z-50 flex max-w-md items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 shadow-lg"
    >
      <div className="flex-1 space-y-0.5 leading-relaxed">
        <div className="font-medium">{title}</div>
        {detail && <p className="text-rose-900/70">{detail}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-rose-500 hover:text-rose-700">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Workspace({ initial, initialChangeId = null, initialPrompt = null }: { initial: WorkspaceSnapshot; initialChangeId?: string | null; initialPrompt?: string | null }) {
  const api = useWorkspace(initial);
  const { snapshot, events, progress } = api;
  // Nothing is selected at first: the Inspector opens on the project, not on an arbitrary scenario.
  const [selection, setSelection] = useState<Selection>(null);
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

  const protection = protectionSummary(snapshot.scenarios, latestRun, progress);
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
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="size-4" />
          </div>
          <span className="text-sm font-semibold">Architect</span>
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-sm font-medium">{snapshot.project.name}</span>
        <div className="ml-2 hidden md:block">
          <EnvironmentButton env={snapshot.env} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {api.busyLabel && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {api.busyLabel}…
            </span>
          )}
          {/* The generated application itself, at its own URL, running these same live agent versions. */}
          <Button variant="ghost" size="sm" asChild>
            <a href={`/preview/${snapshot.project.id}`} target="_blank" rel="noreferrer">
              Preview <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
          {/* Only a project backed by a definition in code has a seeded state to go back to. */}
          {snapshot.project.origin === "definition" && (
            <Button variant="ghost" size="sm" disabled={api.busy} onClick={() => { setOpenChangeId(null); api.reset(); }}>
              <RotateCcw data-icon="inline-start" /> Reset demo
            </Button>
          )}
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

        <Column title={snapshot.changes.length ? "Current change" : "Ask Architect"}>
          <ChangesPanel
            snapshot={snapshot}
            events={events}
            protection={protection}
            progress={progress}
            busy={api.busy}
            drafting={api.busyLabel === "Drafting change"}
            openChangeId={openChangeId}
            onPropose={propose}
            initialPrompt={initialPrompt}
            onOpenChange={setOpenChangeId}
            onViewScenario={() => {
              // The scenario worth looking at is the one that isn't holding, else the first.
              const failing = snapshot.scenarios.find((s) => {
                const status = scenarioStatus(s.key, latestRun, progress);
                return status === "fail" || status === "error";
              });
              const key = (failing ?? snapshot.scenarios[0])?.key;
              if (key) setSelection({ kind: "scenario", key });
            }}
          />
        </Column>

        <Column
          title={selectedScenario ? "Scenario" : selectedAgent ? "Agent" : "Project"}
          action={
            selection && (
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> Overview
              </button>
            )
          }
          className="border-l bg-background"
        >
          {selectedScenario ? (
            <ScenarioInspector
              scenario={selectedScenario}
              status={scenarioStatus(selectedScenario.key, latestRun, progress)}
              result={streaming ? undefined : latestRun?.results?.find((r) => r.scenarioKey === selectedScenario.key)}
              runLabel={context.text}
              agents={snapshot.agents}
              changes={snapshot.changes}
              tools={snapshot.project.tools}
              responsePath={snapshot.project.responsePath}
              onOpenChange={setOpenChangeId}
            />
          ) : selectedAgent ? (
            <AgentInspector agent={selectedAgent} snapshot={snapshot} onOpenChange={setOpenChangeId} />
          ) : (
            <ProjectOverview
              snapshot={snapshot}
              latestRun={latestRun}
              progress={progress}
              onSelectScenario={(key) => setSelection({ kind: "scenario", key })}
            />
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

      {api.error && <ErrorToast message={api.error} onDismiss={api.dismissError} />}
    </div>
  );
}
