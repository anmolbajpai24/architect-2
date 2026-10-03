"use client";

import { ChevronDown, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { envSummary, modelLabel } from "./format";

type Row = { label: string; value: string; tone: "on" | "off" | "demo"; detail: string };

/**
 * How this server is configured, in one place. The product header says only whether this is the offline demo or a
 * live workspace; the specifics — including the environment variables that set them — live behind this popover,
 * so the workspace reads as a product while staying inspectable.
 */
function rows(env: WorkspaceSnapshot["env"]): Row[] {
  return [
    {
      label: "Storage",
      value: env.db === "pglite" ? "Local, in-process" : "Supabase Postgres",
      tone: env.db === "pglite" ? "demo" : "on",
      detail:
        env.db === "pglite"
          ? "Postgres runs inside this server process and starts empty on every restart. Set DATABASE_URL to persist to Supabase."
          : "Connected to the Postgres database in DATABASE_URL.",
    },
    {
      label: "Change proposer",
      value: env.proposer.mode === "live" ? modelLabel(env.proposer.model) : "Recorded demo edits",
      tone: env.proposer.mode === "live" ? "on" : "demo",
      detail:
        env.proposer.mode === "live"
          ? `Architect drafts changes and rule changes with ${env.proposer.model}. Every draft is still verified before it can go live.`
          : "Architect replays the recorded edits for the scripted demo request, so the demo reproduces exactly. Set ANTHROPIC_API_KEY (or ARCHITECT_PROPOSER=live) to draft any change.",
    },
    {
      label: "Agent runtime",
      value: env.mode === "live" ? "Provider models" : "Recorded fixture model",
      tone: env.mode === "live" ? "on" : "demo",
      detail:
        env.mode === "live"
          ? "Scenarios run the agents on the provider model in each agent's configuration."
          : "Scenarios run the agents on a deterministic fixture model, so a verification result is reproducible. Set ARCHITECT_MODEL_MODE=live for real models.",
    },
    {
      label: "LLM judge",
      value: env.judge === "live" ? "On" : "Skipped",
      tone: env.judge === "live" ? "on" : "off",
      detail:
        env.judge === "live"
          ? "Judge checks are scored by JUDGE_MODEL."
          : "Judge checks report as skipped; the deterministic tool and output checks decide pass or fail. Set ARCHITECT_JUDGE=live to enable them.",
    },
    {
      label: "GitHub",
      value: env.github.configured ? env.github.repositories.join(", ") : "Not connected",
      tone: env.github.configured ? "on" : "off",
      detail: env.github.configured
        ? "Verified, applied changes can be shipped as pull requests to these repositories. The credential stays on the server."
        : [
            "Set ARCHITECT_GITHUB_TOKEN and ARCHITECT_GITHUB_REPOS to ship verified changes as pull requests; everything else works without it.",
            // Misconfiguration (as opposed to simply unset) is worth repeating verbatim.
            ...env.github.problems.filter((p) => p.includes("invalid")),
          ].join(" "),
    },
  ];
}

const dotTone = { on: "bg-emerald-500", off: "bg-muted-foreground/40", demo: "bg-amber-400" };

export function EnvironmentButton({ env }: { env: WorkspaceSnapshot["env"] }) {
  const summary = envSummary(env);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground">
            <span className={cn("size-1.5 rounded-full", summary.mode === "demo" ? "bg-amber-400" : "bg-emerald-500")} />
            {summary.label}
            <ChevronDown className="size-3" />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{summary.summary}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80">
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
          <Settings2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Environment</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{summary.label}</span>
        </div>
        <dl className="divide-y">
          {rows(env).map((r) => (
            <div key={r.label} className="px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", dotTone[r.tone])} />
                <dt className="text-[11px] text-muted-foreground">{r.label}</dt>
                <dd className="ml-auto min-w-0 truncate text-right font-mono text-[11px]" title={r.value}>
                  {r.value}
                </dd>
              </div>
              <p className="mt-1 pl-3.5 text-[11px] leading-relaxed text-muted-foreground">{r.detail}</p>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
