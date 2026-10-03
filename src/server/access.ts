import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { projects } from "@/db/schema";
import { hasDefinition, knownProjectSlugs, type ProjectRow } from "@/projects/registry";
import { authEnabled, currentUser, type SessionUser } from "./auth";
import { projectById, resolveProject, type ResolvedProject } from "./context";

/**
 * Who may open which project.
 *
 * Two kinds exist and the difference is ownership, not a flag: a project whose slug names a definition in code is
 * a **reference example** and is public to everyone; anything else was created from a brief and belongs to the
 * Supabase user who created it. Enforced here, on the server, for every route and page — the home page listing is
 * a convenience, never the control.
 *
 * Kept apart from `context.ts` on purpose: this module reaches for request cookies, so the scripts (which import
 * the context and the workspace read model) never load it.
 */

/** A code-backed project: the seeded reference demo, public to everyone. */
export const projectIsExample = (row: Pick<ProjectRow, "slug">) => hasDefinition(row.slug);

/** The viewer may not open this project. */
export class ProjectForbidden extends Error {}

/** The viewer may look at this example but must sign in to change it. Answered with 401, not 403. */
export class SignInRequired extends ProjectForbidden {}

/**
 * What a request does with the project. `view` reads it. `change` mutates it or spends model or GitHub calls.
 * Only examples tell the two apart: anyone may explore one, but changing it needs a signed-in viewer. A generated
 * project is owner-only either way.
 */
export type ProjectAccess = "view" | "change";

/**
 * Throws unless the viewer may open this project for `access`.
 *
 * With sign-in switched off this allows everything, so a server without accounts behaves exactly as it did
 * before — including the offline demo and a local PGlite run.
 */
export async function assertProjectAccess(
  row: ProjectRow,
  viewer?: SessionUser | null,
  access: ProjectAccess = "view",
): Promise<void> {
  if (projectIsExample(row)) {
    if (access === "view" || !authEnabled()) return;
    if (viewer === undefined ? await currentUser() : viewer) return;
    throw new SignInRequired("Anyone can explore the demo. Sign in with Google to change or ship it.");
  }
  if (!authEnabled()) return;
  const user = viewer === undefined ? await currentUser() : viewer;
  if (user && row.ownerId === user.id) return;
  throw new ProjectForbidden(
    row.ownerId
      ? "This project belongs to someone else."
      : "This project has no owner, so it can't be opened. Create one from a brief after signing in.",
  );
}

/** Resolve a project and authorize the viewer. Every request-facing caller uses this, not `resolveProject`. */
export async function openProject(db: Db, selector?: string | null, access: ProjectAccess = "view"): Promise<ResolvedProject> {
  const project = await resolveProject(db, selector);
  await assertProjectAccess(project.row, undefined, access);
  return project;
}

/** The same, for a project reached through a change or revision the request named. */
export async function openProjectById(db: Db, id: string, access: ProjectAccess = "view"): Promise<ResolvedProject> {
  const project = await projectById(db, id);
  await assertProjectAccess(project.row, undefined, access);
  return project;
}

export type ProjectCard = { id: string; name: string; brief: string | null };

const card = { id: projects.id, name: projects.name, brief: projects.brief };

/** The reference examples: code-backed, public and stable — not "whatever happens to be in the database". */
export async function listExamples(db: Db): Promise<ProjectCard[]> {
  const slugs = knownProjectSlugs();
  if (slugs.length === 0) return [];
  return db.select(card).from(projects).where(inArray(projects.slug, slugs)).orderBy(projects.createdAt);
}

/**
 * The viewer's own projects, newest first.
 *
 * Signed out (with sign-in configured) this is empty rather than "every project anyone has made": a generated
 * project with no owner predates accounts and belongs to no one, so it is listed nowhere and opens for no one.
 */
export async function listUserProjects(db: Db, viewer: SessionUser | null): Promise<ProjectCard[]> {
  const examples = knownProjectSlugs();
  const notAnExample = examples.length > 0 ? notInArray(projects.slug, examples) : undefined;

  if (!authEnabled()) {
    // No accounts on this server: a generated project is simply this machine's.
    return db
      .select(card)
      .from(projects)
      .where(notAnExample)
      .orderBy(desc(projects.createdAt))
      .limit(6);
  }
  if (!viewer) return [];
  return db
    .select(card)
    .from(projects)
    .where(and(eq(projects.ownerId, viewer.id), notAnExample))
    .orderBy(desc(projects.createdAt))
    .limit(6);
}
