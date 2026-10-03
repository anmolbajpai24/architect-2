"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LoaderCircle, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { NormalizedBlueprint } from "@/projects/blueprint";

/**
 * The creation flow: a brief becomes a plan the user reads, and then a real project.
 *
 * Every state here is a state the server is actually in. "Planning" means a request is in flight; the review is
 * the blueprint that will be built, not a preview of one; "Building" means the transaction is running. Nothing
 * is checked off before it has happened, and no stage is shown that the server didn't do.
 */

type Plan = { blueprint: NormalizedBlueprint; notes: string[]; model: string; brief: string };
type Stage = { kind: "idle" } | { kind: "planning" } | { kind: "review"; plan: Plan } | { kind: "building"; plan: Plan };

function Stat({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border bg-background p-5 text-sm shadow-sm">
      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}

function Review({
  plan,
  busy,
  onBuild,
  onBack,
}: {
  plan: Plan;
  busy: boolean;
  onBuild: () => void;
  onBack: () => void;
}) {
  const { blueprint, notes } = plan;
  return (
    <div className="rounded-2xl border bg-background shadow-sm">
      <div className="border-b p-5">
        <p className="text-xs text-muted-foreground">Architect understands your product as</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{blueprint.name}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{blueprint.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Stat icon={Users}>
            {blueprint.agents.length} agent{blueprint.agents.length === 1 ? "" : "s"}
          </Stat>
          <Stat icon={ShieldCheck}>
            {blueprint.scenarios.length} protected behavior{blueprint.scenarios.length === 1 ? "" : "s"}
          </Stat>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agents</h3>
          <ul className="mt-2 space-y-2">
            {blueprint.agents.map((agent, i) => (
              <li key={agent.key} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{agent.name}</span>
                  {i === 0 && (
                    <span className="rounded bg-foreground px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-background">
                      entry
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{agent.role}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Protected behaviors
          </h3>
          <ul className="mt-2 space-y-2">
            {blueprint.scenarios.map((scenario) => (
              <li key={scenario.key} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="text-[13px] font-medium">{scenario.name}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{scenario.intent}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {notes.length > 0 && (
        <div className="border-t px-5 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Adjusted to fit what Architect runs
          </h3>
          <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
            {notes.map((note, i) => (
              <li key={i}>· {note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4">
        <button
          type="button"
          disabled={busy}
          onClick={onBuild}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Build this system
        </button>
        <button type="button" disabled={busy} onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          Start over
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          These agents run on real models and have no tools yet.
        </span>
      </div>
    </div>
  );
}

export function CreateProject({ examples }: { examples: string[] }) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const busy = stage.kind === "planning" || stage.kind === "building";

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  };

  const plan = async (text: string) => {
    setError(null);
    setStage({ kind: "planning" });
    try {
      setStage({ kind: "review", plan: (await post("/api/projects/plan", { brief: text })) as Plan });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage({ kind: "idle" });
    }
  };

  const build = async (current: Plan) => {
    setError(null);
    setStage({ kind: "building", plan: current });
    try {
      const created = (await post("/api/projects", {
        brief: current.brief,
        blueprint: current.blueprint,
      })) as { projectId: string };
      router.push(`/workspace?project=${created.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage({ kind: "review", plan: current });
    }
  };

  return (
    <div className="mt-10 max-w-2xl space-y-4">
      {stage.kind === "idle" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (brief.trim().length >= 10) plan(brief.trim());
            }}
            className="rounded-2xl border bg-background p-4 shadow-sm"
          >
            <label htmlFor="project-brief" className="text-sm font-semibold">
              Start with a prompt
            </label>
            <textarea
              id="project-brief"
              name="brief"
              required
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What should your agent system do?"
              className="mt-3 w-full resize-none rounded-lg border bg-muted/30 p-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Architect plans the system, then you decide to build it.</span>
              <button
                type="submit"
                disabled={brief.trim().length < 10}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40"
              >
                Start building <ArrowRight className="size-4" />
              </button>
            </div>
          </form>

          <div className="grid gap-3 sm:grid-cols-3">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setBrief(example)}
                className="rounded-xl border bg-background p-3 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <span className="mb-2 block text-foreground">Try a brief</span>
                {example}
              </button>
            ))}
          </div>
        </>
      )}

      {stage.kind === "planning" && <Working label="Understanding your brief…" />}
      {stage.kind === "review" && <Review plan={stage.plan} busy={false} onBuild={() => build(stage.plan)} onBack={() => setStage({ kind: "idle" })} />}
      {stage.kind === "building" && (
        <>
          <Review plan={stage.plan} busy onBuild={() => {}} onBack={() => {}} />
          <Working label="Creating the agents and scenarios…" />
        </>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {busy && <p className="text-xs text-muted-foreground">Keep this tab open.</p>}
    </div>
  );
}
