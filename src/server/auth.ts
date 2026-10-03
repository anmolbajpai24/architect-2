import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

/**
 * Sign-in, on the Supabase project this app already uses for its database.
 *
 * Deliberately small: Google is the only provider, the Supabase client lives on the server (no key reaches the
 * browser, nothing is NEXT_PUBLIC_), and Architect stores no user table of its own — a project remembers the
 * Supabase user id that created it and that is the whole identity model.
 *
 * Sign-in is **optional**. Without SUPABASE_URL and SUPABASE_ANON_KEY the app behaves exactly as it did before
 * it had accounts: there is no viewer, every project is reachable, and the deterministic demo is unaffected.
 */

export type AuthStatus = { configured: boolean; problems: string[] };

/** Who is signed in, as the UI needs them. Never a token. */
export type SessionUser = { id: string; email: string | null; name: string | null; avatarUrl: string | null };

export function authStatus(): AuthStatus {
  const env = serverEnv();
  const problems: string[] = [];
  if (!env.SUPABASE_URL) problems.push("SUPABASE_URL is not set");
  if (!env.SUPABASE_ANON_KEY) problems.push("SUPABASE_ANON_KEY is not set");
  return { configured: problems.length === 0, problems };
}

export const authEnabled = () => authStatus().configured;

/**
 * A Supabase client bound to this request's cookies.
 *
 * `setAll` throws in a Server Component, where cookies are read-only. That is expected and harmless: the
 * middleware refreshes the session on every request, so a page only ever reads an already-current one.
 */
export async function supabaseServer(): Promise<SupabaseClient | null> {
  const env = serverEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Component: the middleware already wrote the refreshed cookies onto the response.
        }
      },
    },
  });
}

/**
 * The signed-in user, verified with Supabase rather than trusted from a cookie.
 *
 * Null means "no viewer": either sign-in isn't configured on this server, or nobody is signed in. Callers that
 * need to tell those apart ask `authEnabled()`.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const meta = data.user.user_metadata ?? {};
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
  };
}

/** Where Google sends the browser back to. ARCHITECT_PUBLIC_URL wins, so a proxied origin can't rewrite it. */
export function authOrigin(req: Request): string {
  const configured = serverEnv().ARCHITECT_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}
