"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceEvent, WorkspaceRun, WorkspaceSnapshot } from "@/server/workspace";

export type LiveStatus = "running" | "pass" | "fail" | "error";

/** Progress of the run currently streaming in over SSE, before its results land in the snapshot. */
export type Progress = {
  runId: string;
  changeId: string | null;
  scenarios: Record<string, LiveStatus>;
  finished: boolean;
};

function reduceProgress(p: Progress | null, e: WorkspaceEvent): Progress | null {
  switch (e.type) {
    case "project.seeded":
      return null;
    case "run.started":
      return { runId: e.runId!, changeId: e.changeId, scenarios: {}, finished: false };
    case "scenario.started":
      if (!p || p.runId !== e.runId) return p;
      return { ...p, scenarios: { ...p.scenarios, [e.payload.scenario as string]: "running" } };
    case "scenario.finished":
      if (!p || p.runId !== e.runId) return p;
      return { ...p, scenarios: { ...p.scenarios, [e.payload.scenario as string]: e.payload.status as LiveStatus } };
    case "run.finished":
      return p && p.runId === e.runId ? { ...p, finished: true } : p;
    default:
      return p;
  }
}

/** Server snapshot + live SSE events + the actions the workspace can take. */
export function useWorkspace(initial: WorkspaceSnapshot) {
  // Every request says which project it is about: this workspace serves whichever one was opened.
  const projectId = initial.project.id;
  const [snapshot, setSnapshot] = useState(initial);
  const [events, setEvents] = useState(initial.events);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspace?project=${projectId}`, { cache: "no-store" });
    if (res.ok) setSnapshot(await res.json());
  }, [projectId]);

  // Coalesce bursts of events (a fixture run emits dozens in milliseconds) into one snapshot fetch.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 150);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource(`/api/events?project=${projectId}&after=${initial.lastSeq}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WorkspaceEvent;
      setEvents((prev) => (event.type === "project.seeded" ? [event] : [...prev, event].slice(-300)));
      setProgress((p) => reduceProgress(p, event));
      if (event.type === "job.failed") setError(`${event.payload.job}: ${event.payload.message}`);
      scheduleRefresh();
    };
    return () => {
      source.close();
      clearTimeout(refreshTimer.current);
    };
  }, [initial.lastSeq, projectId, scheduleRefresh]);

  const post = useCallback(
    async <T = Record<string, unknown>>(label: string, url: string, body?: unknown): Promise<T | null> => {
      setPending(label);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? `Request failed (${res.status})`);
          return null;
        }
        scheduleRefresh();
        return json as T;
      } finally {
        setPending(null);
      }
    },
    [scheduleRefresh],
  );

  const runInFlight = progress && !progress.finished;
  const busy = Boolean(pending || snapshot.busy || runInFlight);

  return {
    snapshot,
    events,
    progress,
    busy,
    busyLabel: pending ?? snapshot.busy ?? (runInFlight ? "Running scenarios" : null),
    error,
    dismissError: () => setError(null),
    runScenarios: () => post("Starting run", `/api/runs?project=${projectId}`),
    proposeChange: (intent: string) =>
      post<{ changeId: string }>("Drafting change", `/api/changes?project=${projectId}`, { intent }),
    keepRuleAndFix: (changeId: string) => post<{ changeId: string }>("Drafting fix", `/api/changes/${changeId}/fix`),
    applyChange: (changeId: string) => post("Applying change", `/api/changes/${changeId}/apply`),
    draftRuleChange: (changeId: string, scenarioKey: string, request: string) =>
      post<{ revisionId: string }>("Drafting rule change", "/api/scenario-revisions", { changeId, scenarioKey, request }),
    applyRuleChange: (revisionId: string) => post("Applying new rule", `/api/scenario-revisions/${revisionId}/apply`),
    discardRuleChange: (revisionId: string) => post("Discarding draft", `/api/scenario-revisions/${revisionId}/discard`),
    shipChange: (changeId: string, repository: string) =>
      post<{ alreadyShipped: boolean; shipment: { prNumber: number; prUrl: string } }>("Shipping to GitHub", `/api/changes/${changeId}/ship`, {
        repository,
      }),
    reset: () => post("Resetting demo", `/api/reset?project=${projectId}`),
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;

export type DisplayStatus = LiveStatus | "queued" | "idle";

/** The streaming run, if the snapshot hasn't caught up with it yet. */
export function streamingProgress(latestRun: WorkspaceRun | undefined, progress: Progress | null): Progress | null {
  if (!progress) return null;
  return latestRun?.id !== progress.runId || !latestRun.results ? progress : null;
}

/** Scenario status to show: live progress while a run streams in, otherwise the latest run's stored result. */
export function scenarioStatus(key: string, latestRun: WorkspaceRun | undefined, progress: Progress | null): DisplayStatus {
  const streaming = streamingProgress(latestRun, progress);
  if (streaming) return streaming.scenarios[key] ?? (streaming.finished ? "idle" : "queued");
  return latestRun?.results?.find((r) => r.scenarioKey === key)?.status ?? "idle";
}

export type Protection = { total: number; passing: number; failing: number; notRun: boolean };

/** How much of this app's protected behavior currently holds, as the workspace states it in several places. */
export function protectionSummary(
  scenarios: { key: string }[],
  latestRun: WorkspaceRun | undefined,
  progress: Progress | null,
): Protection {
  const statuses = scenarios.map((s) => scenarioStatus(s.key, latestRun, progress));
  return {
    total: scenarios.length,
    passing: statuses.filter((s) => s === "pass").length,
    failing: statuses.filter((s) => s === "fail" || s === "error").length,
    notRun: statuses.length > 0 && statuses.every((s) => s === "idle"),
  };
}
