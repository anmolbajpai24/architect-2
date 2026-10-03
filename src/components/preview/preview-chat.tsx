"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CircleAlert, LoaderCircle, SendHorizontal, Wrench } from "lucide-react";
import { summarizeToolResult } from "@/domain/format";
import type { ToolResultSummary, Trace } from "@/domain/schemas";
import type { PreviewAgent } from "@/preview/session";
import { Disclosure } from "@/components/workspace/disclosure";
import { JsonBlock } from "@/components/workspace/json-block";
import { cn } from "@/lib/utils";

/**
 * The preview surface: the generated application, as its user would meet it.
 *
 * It is deliberately not a simulation. Every answer here came back from `POST /api/preview`, which ran the
 * project's live agents through the same runtime the scenarios use. The trace behind each answer is the real
 * one, which is why it is one click away rather than hidden: a preview you cannot check is a demo.
 */

export type PreviewTool = { name: string; resultSummary: ToolResultSummary | null };

type Turn = {
  message: string;
  reply: string | null;
  trace: Trace;
  agents: PreviewAgent[];
};

function AgentLineup({ agents }: { agents: PreviewAgent[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {agents.map((agent) => (
        <span
          key={agent.key}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
            agent.entry ? "border-foreground/30 bg-foreground/5 font-medium" : "bg-background text-muted-foreground",
          )}
        >
          {agent.name}
          <span className="font-mono text-[10px] text-muted-foreground">v{agent.version}</span>
        </span>
      ))}
    </div>
  );
}

/** How the answer was produced: the agents that ran, what they called, and what each returned. */
function TraceDetail({ trace, tools }: { trace: Trace; tools: PreviewTool[] }) {
  const ran = Object.values(trace.agents);
  return (
    <Disclosure label="How this answer was produced" hint={`${ran.length} agent${ran.length === 1 ? "" : "s"}`}>
      <div className="space-y-2">
        {trace.error && <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">Runtime error: {trace.error}</p>}
        {ran.map((agentTrace) => (
          <div key={agentTrace.agent} className="rounded-lg border bg-muted/20 p-2.5">
            <div className="mb-1.5 font-mono text-[11px] text-muted-foreground">{agentTrace.agent}</div>
            {agentTrace.toolCalls.map((call, i) => (
              <div key={i} className="mb-1.5 rounded-md bg-violet-50/60 p-2 font-mono text-[11px] leading-relaxed">
                <div className="text-violet-800">
                  {call.tool}({JSON.stringify(call.args)})
                </div>
                <div className="text-muted-foreground">
                  → {summarizeToolResult(call.result, tools.find((t) => t.name === call.tool)?.resultSummary)}
                </div>
              </div>
            ))}
            <JsonBlock value={agentTrace.output} />
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

export function PreviewChat({
  project,
  agents: initialAgents,
  tools,
  mode,
  problem,
}: {
  project: { id: string; name: string; origin: "definition" | "brief" };
  agents: PreviewAgent[];
  tools: PreviewTool[];
  mode: "fixture" | "live";
  /** Why this server can't run these agents, in the user's language. Null when it can. */
  problem: string | null;
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (message: string) => {
    setDraft("");
    setPending(message);
    setError(null);
    try {
      const res = await fetch(`/api/preview?project=${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setTurns((prev) => [...prev, { message, reply: json.reply, trace: json.trace, agents: json.agents }]);
      // The lineup comes back from the turn that just ran, so an applied change shows up here immediately.
      setAgents(json.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  const toolNames = tools.map((t) => t.name);

  return (
    <div className="flex h-dvh flex-col bg-muted/30 text-foreground">
      <header className="shrink-0 border-b bg-background px-5 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
              Preview
            </span>
            <span className="text-sm font-semibold">{project.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {mode === "live" ? "Live models" : "Demo mode"}
            </span>
            <Link
              href={`/workspace?project=${project.id}`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Back to Architect
            </Link>
          </div>
          <AgentLineup agents={agents} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            This runs {project.name}&apos;s live agents, the same ones Architect verifies — not a mock.{" "}
            {toolNames.length > 0 ? (
              <>
                They can call <span className="font-mono">{toolNames.join(", ")}</span>.
              </>
            ) : (
              <>They have no tools: they answer from your message alone, with no lookups or stored data.</>
            )}{" "}
            Apply a change in Architect and reload to preview the new version.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {problem && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{problem}</span>
            </div>
          )}

          {turns.length === 0 && !pending && (
            <p className="text-sm text-muted-foreground">
              Send a message to {agents.find((a) => a.entry)?.name ?? "the entry agent"} to see how this system
              answers it.
            </p>
          )}

          {turns.map((turn, i) => (
            <div key={i} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-foreground px-3 py-2 text-[13px] leading-relaxed text-background">
                  {turn.message}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <Bot className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {turn.reply ? (
                    <div className="rounded-xl rounded-tl-sm border bg-background px-3 py-2 text-[13px] leading-relaxed">
                      {turn.reply}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      The entry agent produced no response. Its trace is below.
                    </p>
                  )}
                  <TraceDetail trace={turn.trace} tools={tools} />
                </div>
              </div>
            </div>
          ))}

          {pending && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-foreground px-3 py-2 text-[13px] leading-relaxed text-background">
                  {pending}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                {agents.length} agent{agents.length === 1 ? "" : "s"} running…
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-5 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const message = draft.trim();
            if (message && !pending) send(message);
          }}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const message = draft.trim();
                if (message && !pending) send(message);
              }
            }}
            placeholder={`Message ${agents.find((a) => a.entry)?.name ?? "the agents"}…`}
            className="min-h-10 flex-1 resize-none rounded-lg border bg-muted/30 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!draft.trim() || Boolean(pending)}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 disabled:opacity-40"
            aria-label="Send"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </button>
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted-foreground">
          <Wrench className="mr-1 inline size-3" />
          Preview turns are not recorded as verification runs.
        </p>
      </div>
    </div>
  );
}
