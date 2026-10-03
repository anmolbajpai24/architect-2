/**
 * In-memory stand-in for the slice of the GitHub REST API that shipping uses, as a fetch implementation. Lets the
 * real REST provider be tested without network access or creating real pull requests.
 */
import { createHash } from "node:crypto";

type Repo = {
  fullName: string;
  defaultBranch: string;
  refs: Map<string, string>; // branch -> commit sha
  commits: Map<string, { tree: string; parents: string[]; message: string }>;
  trees: Map<string, Map<string, string>>; // tree sha -> path -> content
  pulls: { number: number; title: string; body: string; head: string; base: string; state: string }[];
};

export type FakeCall = { method: string; path: string; authorization: string | null };
export type Failure = { method: string; path: RegExp; status: number; message: string };

const sha = (...parts: string[]) => createHash("sha1").update(parts.join("\0")).digest("hex");

export function createFakeGitHub(opts: { token: string; repos: string[]; nextPullNumber?: number }) {
  const repos = new Map<string, Repo>();
  for (const fullName of opts.repos) {
    const files = new Map([["README.md", `# ${fullName}\n`]]);
    const tree = sha("tree", JSON.stringify([...files]));
    const root = sha("commit", tree, "initial");
    repos.set(fullName, {
      fullName,
      defaultBranch: "main",
      refs: new Map([["main", root]]),
      commits: new Map([[root, { tree, parents: [], message: "Initial commit" }]]),
      trees: new Map([[tree, files]]),
      pulls: [],
    });
  }
  let pullNumber = opts.nextPullNumber ?? 42;
  const calls: FakeCall[] = [];
  const failures: Failure[] = [];

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const path = decodeURIComponent(url.pathname);
    calls.push({ method, path, authorization: headers.get("authorization") });

    if (headers.get("authorization") !== `Bearer ${opts.token}`) return reply(401, { message: "Bad credentials" });
    const failure = failures.find((f) => f.method === method && f.path.test(path));
    if (failure) {
      failures.splice(failures.indexOf(failure), 1);
      return reply(failure.status, { message: failure.message });
    }

    const m = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    const repo = m && repos.get(m[1]);
    if (!repo) return reply(404, { message: "Not Found" });
    const rest = m[2] ?? "";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (method === "GET" && rest === "")
      return reply(200, { full_name: repo.fullName, default_branch: repo.defaultBranch, html_url: `https://github.com/${repo.fullName}` });

    let r: RegExpMatchArray | null;
    if (method === "GET" && (r = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const head = repo.refs.get(r[1]);
      return head ? reply(200, { ref: `refs/heads/${r[1]}`, object: { sha: head } }) : reply(404, { message: "Not Found" });
    }
    if (method === "POST" && rest === "/git/refs") {
      const branch = String(body.ref).replace(/^refs\/heads\//, "");
      if (repo.refs.has(branch)) return reply(422, { message: "Reference already exists" });
      if (!repo.commits.has(body.sha)) return reply(422, { message: "Object does not exist" });
      repo.refs.set(branch, body.sha);
      return reply(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "PATCH" && (r = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      if (!repo.refs.has(r[1])) return reply(422, { message: "Reference does not exist" });
      repo.refs.set(r[1], body.sha);
      return reply(200, { ref: `refs/heads/${r[1]}`, object: { sha: body.sha } });
    }
    if (method === "GET" && (r = rest.match(/^\/git\/commits\/(.+)$/))) {
      const commit = repo.commits.get(r[1]);
      return commit ? reply(200, { sha: r[1], tree: { sha: commit.tree }, message: commit.message }) : reply(404, { message: "Not Found" });
    }
    if (method === "POST" && rest === "/git/trees") {
      const files = new Map(repo.trees.get(body.base_tree) ?? []);
      for (const e of body.tree as { path: string; content: string }[]) files.set(e.path, e.content);
      const tree = sha("tree", JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))));
      repo.trees.set(tree, files);
      return reply(201, { sha: tree });
    }
    if (method === "POST" && rest === "/git/commits") {
      const commit = sha("commit", body.tree, ...body.parents, body.message);
      repo.commits.set(commit, { tree: body.tree, parents: body.parents, message: body.message });
      return reply(201, { sha: commit });
    }
    const toPull = (p: Repo["pulls"][number]) => ({
      number: p.number,
      html_url: `https://github.com/${repo.fullName}/pull/${p.number}`,
      state: p.state,
      head: { ref: p.head },
      base: { ref: p.base },
    });
    if (method === "GET" && rest === "/pulls") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const base = url.searchParams.get("base");
      return reply(200, repo.pulls.filter((p) => p.head === head && (!base || p.base === base)).map(toPull));
    }
    if (method === "POST" && rest === "/pulls") {
      if (!repo.refs.has(body.head)) return reply(422, { message: "Validation Failed: head does not exist" });
      if (repo.refs.get(body.head) === repo.refs.get(body.base)) return reply(422, { message: `No commits between ${body.base} and ${body.head}` });
      if (repo.pulls.some((p) => p.head === body.head && p.base === body.base && p.state === "open"))
        return reply(422, { message: `A pull request already exists for ${body.head}.` });
      const pull = { number: pullNumber++, title: body.title, body: body.body, head: body.head, base: body.base, state: "open" };
      repo.pulls.push(pull);
      return reply(201, toPull(pull));
    }
    return reply(404, { message: `Fake GitHub doesn't implement ${method} ${rest}` });
  };

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    /** Makes the next matching request fail once with this status. */
    failNext: (f: Failure) => failures.push(f),
    repo: (name: string) => repos.get(name)!,
    /** Files on a branch's head. */
    filesAt: (name: string, branch: string) => {
      const repo = repos.get(name)!;
      const head = repo.refs.get(branch);
      return head ? repo.trees.get(repo.commits.get(head)!.tree)! : undefined;
    },
    /** Commits on `branch` that aren't on `base` (linear history). */
    commitsAhead: (name: string, branch: string, base: string) => {
      const repo = repos.get(name)!;
      const stop = repo.refs.get(base);
      const out: string[] = [];
      for (let c = repo.refs.get(branch); c && c !== stop; c = repo.commits.get(c)?.parents[0]) out.push(c);
      return out;
    },
  };
}
