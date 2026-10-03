import { NextResponse } from "next/server";
import { authOrigin, supabaseServer } from "@/server/auth";

/** Starts Google sign-in. Supabase builds the consent URL; the browser is redirected straight to it. */
export async function GET(req: Request) {
  const origin = authOrigin(req);
  const supabase = await supabaseServer();
  if (!supabase) return NextResponse.redirect(`${origin}/?auth=unconfigured`);

  const next = new URL(req.url).searchParams.get("next") ?? "/";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) return NextResponse.redirect(`${origin}/?auth=failed`);
  return NextResponse.redirect(data.url);
}
