/**
 * The narrow slice of GitHub that shipping needs, server-side only. Credentials come from a token supplier so the
 * prototype's environment token and a production GitHub App installation token plug in the same way; the token is
 * only ever placed in the Authorization header of requests to the GitHub API.
 */

export type Repository = { fullName: string; defaultBranch: string; htmlUrl: string };
export type Branch = { name: string; sha: string };
export type FileChange = { path: string; content: string };
/** `created: false` when the branch already held exactly these files (nothing new to commit). */
export type CommitResult = { sha: string; created: boolean };
export type PullRequest = { number: number; url: string; state: string; head: string; base: string };

export interface GitHubProvider {
  getRepository(repo: string): Promise<Repository>;
  /** Null when the branch doesn't exist. */
  getBranch(repo: string, branch: string): Promise<Branch | null>;
  createBranch(repo: string, branch: string, fromSha: string): Promise<Branch>;
  /** One commit on top of the branch head that writes `files` (other files are kept). */
  commitFiles(repo: string, input: { branch: string; message: string; files: FileChange[] }): Promise<CommitResult>;
  /** The pull request (any state) from `head` into `base`, if one exists. */
  findPullRequest(repo: string, input: { head: string; base: string }): Promise<PullRequest | null>;
  createPullRequest(repo: string, input: { title: string; body: string; head: string; base: string }): Promise<PullRequest>;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

type RestOptions = {
  getToken: () => Promise<string>;
  apiUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
};

type GhRef = { ref: string; object: { sha: string } };
type GhPull = { number: number; html_url: string; state: string; head: { ref: string }; base: { ref: string } };

const toPull = (p: GhPull): PullRequest => ({ number: p.number, url: p.html_url, state: p.state, head: p.head.ref, base: p.base.ref });

/** Readable message for a failed GitHub call. Never includes request headers (the token). */
function describeFailure(status: number, what: string, body: { message?: string } | null) {
  const detail = body?.message ? `: ${body.message}` : "";
  if (status === 401) return `GitHub rejected the credential while trying to ${what}${detail}. Check ARCHITECT_GITHUB_TOKEN.`;
  if (status === 403) return `GitHub refused to ${what}${detail}. The token may lack Contents or Pull requests write access.`;
  if (status === 404) return `GitHub couldn't ${what}${detail}. The repository may not exist, or the token can't see it.`;
  return `GitHub failed to ${what} (HTTP ${status})${detail}.`;
}

/** GitHub REST API over fetch: no SDK dependency, and every call goes through one place. */
export function createGitHubRestProvider({ getToken, apiUrl = "https://api.github.com", fetch: fetchImpl = fetch }: RestOptions): GitHubProvider {
  async function call<T>(method: string, path: string, what: string, body?: unknown, { allow404 = false } = {}): Promise<T | null> {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await getToken()}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "architect-2.0",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow404 && res.status === 404) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(describeFailure(res.status, what, json), res.status);
    return json as T;
  }
  const must = async <T>(p: Promise<T | null>) => (await p) as T;
  const repoPath = (repo: string) => `/repos/${repo.split("/").map(encodeURIComponent).join("/")}`;
  const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

  async function getBranch(repo: string, branch: string): Promise<Branch | null> {
    // An empty repository answers 409 here; surface that as a readable error rather than "branch missing".
    const ref = await call<GhRef>("GET", `${repoPath(repo)}/git/ref/heads/${refPath(branch)}`, `read branch ${branch}`, undefined, {
      allow404: true,
    }).catch((err) => {
      if (err instanceof GitHubError && err.status === 409)
        throw new GitHubError(`${repo} is empty. Push an initial commit (a README is enough) and ship again.`, 409);
      throw err;
    });
    return ref ? { name: branch, sha: ref.object.sha } : null;
  }

  return {
    async getRepository(repo) {
      const r = await must(call<{ full_name: string; default_branch: string; html_url: string }>("GET", repoPath(repo), `read ${repo}`));
      return { fullName: r.full_name, defaultBranch: r.default_branch, htmlUrl: r.html_url };
    },

    getBranch,

    async createBranch(repo, branch, fromSha) {
      const ref = await must(
        call<GhRef>("POST", `${repoPath(repo)}/git/refs`, `create branch ${branch}`, { ref: `refs/heads/${branch}`, sha: fromSha }),
      );
      return { name: branch, sha: ref.object.sha };
    },

    async commitFiles(repo, { branch, message, files }) {
      const head = await getBranch(repo, branch);
      if (!head) throw new GitHubError(`Branch ${branch} disappeared before the commit.`, 404);
      const headCommit = await must(call<{ tree: { sha: string } }>("GET", `${repoPath(repo)}/git/commits/${head.sha}`, "read the branch head"));
      const tree = await must(
        call<{ sha: string }>("POST", `${repoPath(repo)}/git/trees`, "write the files", {
          base_tree: headCommit.tree.sha,
          tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
        }),
      );
      // Same tree as the head: these exact files are already committed (e.g. a retried ship). Don't add an empty commit.
      if (tree.sha === headCommit.tree.sha) return { sha: head.sha, created: false };
      const commit = await must(
        call<{ sha: string }>("POST", `${repoPath(repo)}/git/commits`, "create the commit", { message, tree: tree.sha, parents: [head.sha] }),
      );
      await call("PATCH", `${repoPath(repo)}/git/refs/heads/${refPath(branch)}`, `move ${branch} to the new commit`, {
        sha: commit.sha,
        force: false,
      });
      return { sha: commit.sha, created: true };
    },

    async findPullRequest(repo, { head, base }) {
      const owner = repo.split("/")[0];
      const query = new URLSearchParams({ head: `${owner}:${head}`, base, state: "all" });
      const pulls = await must(call<GhPull[]>("GET", `${repoPath(repo)}/pulls?${query}`, "look for an existing pull request"));
      return pulls[0] ? toPull(pulls[0]) : null;
    },

    async createPullRequest(repo, input) {
      return toPull(await must(call<GhPull>("POST", `${repoPath(repo)}/pulls`, "open the pull request", input)));
    },
  };
}
