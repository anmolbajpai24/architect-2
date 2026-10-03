"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { ProjectCard } from "@/server/access";

/**
 * Opening a project renders its workspace on the server, which takes a moment. The row says so as soon as it is
 * clicked, rather than looking inert until the page swaps.
 */
export function ProjectLink({ project, subtitle }: { project: ProjectCard; subtitle?: string }) {
  const [opening, setOpening] = useState(false);
  return (
    <Link
      href={`/workspace?project=${project.id}`}
      onClick={() => setOpening(true)}
      aria-disabled={opening}
      className="flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40 aria-disabled:pointer-events-none"
    >
      <span className="shrink-0 font-medium">{project.name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{subtitle ?? project.brief ?? ""}</span>
      {opening ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </Link>
  );
}
