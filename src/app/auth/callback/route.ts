import { NextResponse } from "next/server";
import { authOrigin, supabaseServer } from "@/server/auth";

/**
 * Where Google sends the browser back. The one-time code is exchanged for a session, which Supabase writes as
 * cookies on this response; from here on every request carries it.
 */
export async function GET(req: Request) {
  const origin = authOrigin(req);
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/";
  // Only same-app destinations, so a crafted link can't bounce a signed-in user off-site.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return NextResponse.redirect(`${origin}/?auth=failed&reason=${encodeURIComponent(providerError)}`);

  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/?auth=failed`);

  const supabase = await supabaseServer();
  if (!supabase) return NextResponse.redirect(`${origin}/?auth=unconfigured`);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/?auth=failed&reason=${encodeURIComponent(error.message)}`);
  return NextResponse.redirect(`${origin}${destination}`);
}
