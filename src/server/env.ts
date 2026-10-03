import { z } from "zod";

/**
 * The one place server configuration is read. Nothing here is exposed to the browser: no variable is prefixed
 * `NEXT_PUBLIC_`, and client code only ever sees the derived booleans in `WorkspaceSnapshot["env"]`.
 */

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
  z.string().optional(),
);
const optionalMode = (values: [string, ...string[]]) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() ? value.trim() : undefined), z.enum(values).optional());
const optionalFlag = z.preprocess(
  (value) => (typeof value === "string" ? ["1", "true", "yes"].includes(value.trim().toLowerCase()) : undefined),
  z.boolean().optional(),
);

const EnvSchema = z.object({
  DATABASE_URL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  ARCHITECT_MODEL_MODE: optionalMode(["fixture", "live"]),
  ARCHITECT_JUDGE: optionalMode(["skip", "live"]),
  ARCHITECT_PROPOSER: optionalMode(["fixture", "live"]),
  ARCHITECT_PROPOSER_MODEL: optionalString,
  /** Opt in to running a deployed instance on the ephemeral in-process database. See docs/DEPLOYMENT.md. */
  ARCHITECT_ALLOW_EPHEMERAL_DB: optionalFlag,
  JUDGE_MODEL: optionalString,
});

export type ServerEnv = z.infer<typeof EnvSchema>;

/** A variable is set to something this app can't act on. Loud on purpose: silence would hide the real mode. */
export class ConfigError extends Error {}

let loaded = false;

/**
 * Load local env files once, for processes that don't do it themselves (the `tsx` scripts).
 * `next dev`/`next build` already populate `process.env`, and a deployed process gets its platform environment.
 * `process.loadEnvFile` never overwrites a variable that is already set, so the precedence is
 * real environment → `.env.local` → `.env`, the same order Next.js uses.
 */
export function loadServerEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing file: the next candidate, or the process environment, is expected to carry the values.
    }
  }
}

/** Read only server-side settings. Never import this module from a client component. */
export function serverEnv(): ServerEnv {
  loadServerEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new ConfigError(`This server's configuration can't be read — ${problems.join("; ")}`);
}

/**
 * True on a managed host (Vercel), where the process is replaceable and nothing on its filesystem survives.
 * Used to refuse configurations that only make sense on a developer machine.
 */
export function isManagedDeployment(): boolean {
  return Boolean(process.env.VERCEL);
}

export function apiKeyForModel(spec: string): string | undefined {
  const env = serverEnv();
  return spec.startsWith("anthropic:") ? env.ANTHROPIC_API_KEY : spec.startsWith("openai:") ? env.OPENAI_API_KEY : undefined;
}

/** Values that must never reach a response body or a log line, for redacting error messages. */
export function secretValues(): string[] {
  const env = serverEnv();
  return [env.DATABASE_URL, env.ANTHROPIC_API_KEY, env.OPENAI_API_KEY, process.env.ARCHITECT_GITHUB_TOKEN?.trim()].filter(
    (v): v is string => Boolean(v && v.length >= 8),
  );
}

/** An error message safe to return from an endpoint: configured secrets and any credential-bearing URL removed. */
export function redactSecrets(message: string): string {
  let out = message;
  for (const secret of secretValues()) out = out.split(secret).join("[redacted]");
  return out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1[redacted]@");
}
