"use client";

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import type { SessionUser } from "@/server/auth";

/**
 * Sign in with Google, or sign out. Both navigate, so both say so the moment they are clicked: a button that
 * looks idle while a round trip to Google is in flight reads as a button that didn't work.
 */
export function AuthButton({ user, configured }: { user: SessionUser | null; configured: boolean }) {
  const [pending, setPending] = useState<"in" | "out" | null>(null);

  if (!configured) {
    return <span className="text-xs text-muted-foreground">Sign-in isn&apos;t configured on this server</span>;
  }

  if (!user) {
    return (
      <a
        href="/auth/signin"
        onClick={() => setPending("in")}
        aria-disabled={pending === "in"}
        className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50 aria-disabled:pointer-events-none aria-disabled:opacity-60"
      >
        {pending === "in" ? <LoaderCircle className="size-4 animate-spin" /> : <GoogleMark />}
        {pending === "in" ? "Opening Google…" : "Sign in with Google"}
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline" title={user.email ?? undefined}>
        {user.name ?? user.email}
      </span>
      <form method="post" action="/auth/signout" onSubmit={() => setPending("out")}>
        <button
          type="submit"
          disabled={pending === "out"}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {pending === "out" ? <LoaderCircle className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
          {pending === "out" ? "Signing out…" : "Sign out"}
        </button>
      </form>
    </div>
  );
}

/** Google's mark, inline so the button needs no extra asset or dependency. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.9 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.2a14.6 14.6 0 0 1 0-8.4l-7.8-6.1a24 24 0 0 0 0 20.6l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.4-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  );
}
