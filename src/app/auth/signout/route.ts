import { NextResponse } from "next/server";
import { authOrigin, supabaseServer } from "@/server/auth";

/** POST so a prefetch or an image tag can't sign anyone out. */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut();
  return NextResponse.redirect(`${authOrigin(req)}/`, { status: 303 });
}
