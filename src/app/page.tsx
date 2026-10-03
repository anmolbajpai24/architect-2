import { ArrowRight, Boxes, FlaskConical, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { CreateProject } from "@/components/home/create-project";
import { projects } from "@/db/schema";
import { getDb } from "@/server/context";

const examples = [
  "Build an AI support assistant for an ecommerce company that handles refund requests, checks order information, and escalates unusual cases to a human.",
  "A research assistant that cites evidence before making recommendations",
  "A triage workflow that routes urgent issues to a human",
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { change } = await searchParams;
  if (typeof change === "string" && change) redirect(`/workspace?change=${encodeURIComponent(change)}`);

  await connection();
  const { db } = await getDb();
  const recent = await db
    .select({ id: projects.id, name: projects.name, brief: projects.brief })
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .limit(6);

  return (
    <main className="min-h-dvh bg-muted/30 text-foreground">
      <header className="flex h-14 items-center border-b bg-background px-5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="size-4" />
          </div>
          <span className="text-sm font-semibold">Architect</span>
        </div>
        <Link href="/workspace" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          Open demo <ArrowRight className="ml-1 inline size-3.5" />
        </Link>
      </header>

      <section className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-4xl flex-col justify-center px-6 py-16">
        <div className="max-w-2xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Agent systems, with proof</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">Describe what you want to build.</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Architect turns a product brief into an agent workflow you can inspect, change, and verify against protected behavior.
          </p>
        </div>

        <CreateProject examples={examples} />

        {recent.length > 0 && (
          <div className="mt-10 max-w-2xl">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your projects</h2>
            <ul className="mt-3 divide-y rounded-xl border bg-background">
              {recent.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/workspace?project=${project.id}`}
                    className="flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40"
                  >
                    <span className="font-medium">{project.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {project.brief ?? "Seeded reference project"}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-12 grid gap-4 border-t pt-6 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="flex gap-2"><FlaskConical className="mt-0.5 size-4 shrink-0" /> Define the workflow</div>
          <div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> Protect behavior with scenarios</div>
          <div className="flex gap-2"><ArrowRight className="mt-0.5 size-4 shrink-0" /> Review changes before they go live</div>
        </div>
      </section>
    </main>
  );
}
