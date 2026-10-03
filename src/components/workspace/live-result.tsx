"use client";

import { ExternalLink, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSnapshot } from "@/server/workspace";
import { Disclosure } from "./disclosure";

/**
 * The end of the flow: where the change you just verified, applied and shipped is actually running.
 *
 * This is deliberately not a "Deploy" button. Architect is the runtime — a project's agents are rows, and the
 * preview executes them — so the verified system is live the moment the change is applied. Claiming a deployment
 * step here would be theatre. What the panel adds is the thing the flow was missing: the address of the running
 * system, and a straight answer about what merging the pull request does (nothing, to the runtime).
 */
export function LiveResult({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const path = `/preview/${snapshot.project.id}`;
  const url = snapshot.env.publicUrl ? `${snapshot.env.publicUrl}${path}` : null;
  const live = snapshot.agents
    .map((a) => ({ name: a.name, version: a.versions.find((v) => v.id === a.currentVersionId)?.version }))
    .filter((a) => a.version !== undefined);

  return (
    <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        <Radio className="size-3.5" /> Running now
      </div>
      <p className="text-xs leading-relaxed">
        {snapshot.project.name} is answering on{" "}
        {live.map((a, i) => (
          <span key={a.name}>
            {i > 0 && ", "}
            {a.name} <span className="font-mono text-[11px]">v{a.version}</span>
          </span>
        ))}
        {" — the versions this change verified."}
      </p>

      {url && (
        <div className="truncate rounded-lg border bg-background px-2.5 py-1.5 font-mono text-[11px]" title={url}>
          {url}
        </div>
      )}

      <Button asChild className="w-full">
        <a href={path} target="_blank" rel="noreferrer">
          <ExternalLink data-icon="inline-start" /> Open live result
        </a>
      </Button>

      <Disclosure label="What “live” means here" className="bg-background/70">
        <div className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Architect is the runtime. The agents run in this server process, on its model credential, and applying a
            change makes the next request use the new versions — so there is no separate build, host or release.
          </p>
          <p>
            Merging the pull request <span className="font-medium text-foreground">deploys nothing</span>: it records
            the verified state in your repository for review and history.
          </p>
          <p>
            Per-project isolated deployment — a sandbox, a preview gateway and a deployment worker — is described in{" "}
            <span className="font-mono">docs/architecture.md</span> and is not built.
          </p>
        </div>
      </Disclosure>
    </div>
  );
}
