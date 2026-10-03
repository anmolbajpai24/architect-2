import { Boxes, FlaskConical, GitPullRequest, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthButton } from "@/components/home/auth-button";
import { CreateProject } from "@/components/home/create-project";
import { ProjectLink } from "@/components/home/project-link";
import { authStatus, currentUser } from "@/server/auth";
import { listExamples, listUserProjects } from "@/server/access";
import { getDb } from "@/server/context";

const briefs = [
  "Build an AI support assistant for an ecommerce company that handles refund requests, checks order information, and escalates unusual cases to a human.",
  "A research assistant that cites evidence before making recommendations",
  "A triage workflow that routes urgent issues to a human",
];

const promises = [
  { icon: FlaskConical, title: "Define the workflow", body: "A brief becomes agents you can read and edit." },
  { icon: ShieldCheck, title: "Protect behavior", body: "Scenarios hold the rules that must keep passing." },
  { icon: GitPullRequest, title: "Review before live", body: "Every change is verified, then shipped." },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const List = ({ children }: { children: React.ReactNode }) => (
  <ul className="divide-y overflow-hidden rounded-xl border bg-background">{children}</ul>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-dashed px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">{children}</div>
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const change = params.change;
  if (typeof change === "string" && change) redirect(`/workspace?change=${encodeURIComponent(change)}`);

  await connection();
  const { db } = await getDb();
  const auth = authStatus();
  const user = await currentUser();
  const [examples, mine] = await Promise.all([listExamples(db), listUserProjects(db, user)]);
  const authError = params.auth === "failed" ? "Google sign-in didn't complete. Try again." : null;

  return (
    <main className="flex min-h-dvh flex-col bg-muted/30 text-foreground">
      <header className="flex h-14 shrink-0 items-center border-b bg-background px-5">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="size-4" />
          </div>
          <span className="text-sm font-semibold">Architect</span>
          <div className="ml-auto">
            <AuthButton user={user} configured={auth.configured} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-8">
        <div className="w-full max-w-3xl space-y-8">
          <div className="text-center">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Agent systems, with proof
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Describe what you want to build.</h1>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
              Architect turns a product brief into an agent workflow you can inspect, change, and verify against
              protected behavior.
            </p>
          </div>

          {authError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900">
              {authError}
            </div>
          )}

          <CreateProject briefs={briefs} signedIn={!auth.configured || Boolean(user)} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="Examples">
              {examples.length > 0 ? (
                <List>
                  {examples.map((project) => (
                    <li key={project.id}>
                      <ProjectLink project={project} subtitle="Reference project" />
                    </li>
                  ))}
                </List>
              ) : (
                <Empty>No reference projects are seeded on this server.</Empty>
              )}
            </Section>

            <Section title="Your projects">
              {mine.length > 0 ? (
                <List>
                  {mine.map((project) => (
                    <li key={project.id}>
                      <ProjectLink project={project} />
                    </li>
                  ))}
                </List>
              ) : (
                <Empty>
                  {auth.configured && !user
                    ? "Sign in with Google to create projects and find them here."
                    : "Projects you create from a brief appear here."}
                </Empty>
              )}
            </Section>
          </div>

          <div className="grid gap-3 border-t pt-6 sm:grid-cols-3">
            {promises.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-background p-3.5">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium">{title}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
