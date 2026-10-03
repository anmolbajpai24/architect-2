import { createGitHubRestProvider, type GitHubProvider } from "./provider";

/**
 * Prototype GitHub configuration, read from the server environment only. Architect-prefixed names keep an ambient
 * GITHUB_TOKEN (CI, a developer shell) from being picked up by accident: shipping is opt-in.
 *
 * - ARCHITECT_GITHUB_TOKEN: a fine-grained token scoped to the listed repositories (Contents + Pull requests: write).
 * - ARCHITECT_GITHUB_REPOS: comma-separated "owner/name" allowlist the user may ship to.
 * - ARCHITECT_PUBLIC_URL (optional): where this workspace is reachable, for links back from the PR.
 * - ARCHITECT_GITHUB_API_URL (optional): GitHub Enterprise Server, or a local fake GitHub for manual testing.
 */

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** What the client may know about GitHub: never the token. */
export type GitHubStatus = { configured: boolean; repositories: string[]; problems: string[] };

type Env = Record<string, string | undefined>;

export function githubStatus(env: Env = process.env): GitHubStatus {
  const repositories = (env.ARCHITECT_GITHUB_REPOS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const problems: string[] = [];
  if (!env.ARCHITECT_GITHUB_TOKEN?.trim()) problems.push("ARCHITECT_GITHUB_TOKEN is not set");
  if (!repositories.length) problems.push("ARCHITECT_GITHUB_REPOS is not set");
  const invalid = repositories.filter((r) => !REPO.test(r));
  if (invalid.length) problems.push(`ARCHITECT_GITHUB_REPOS has invalid entries (expected owner/name): ${invalid.join(", ")}`);
  return { configured: problems.length === 0, repositories: repositories.filter((r) => REPO.test(r)), problems };
}

/** The server-side provider for the configured credential, or null when GitHub isn't configured. */
export function githubProviderFromEnv(env: Env = process.env): GitHubProvider | null {
  if (!githubStatus(env).configured) return null;
  const token = env.ARCHITECT_GITHUB_TOKEN!.trim();
  // Production swaps this supplier for a short-lived GitHub App installation token (see docs/architecture.md).
  const apiUrl = env.ARCHITECT_GITHUB_API_URL?.trim().replace(/\/+$/, "") || undefined;
  return createGitHubRestProvider({ getToken: async () => token, apiUrl });
}

export const publicUrl = (env: Env = process.env) => env.ARCHITECT_PUBLIC_URL?.trim().replace(/\/+$/, "") || null;
