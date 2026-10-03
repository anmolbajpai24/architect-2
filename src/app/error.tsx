"use client";

import { Button } from "@/components/ui/button";

/**
 * Fallback when the workspace can't be rendered at all. On a fresh deployment that is almost always configuration
 * (no database, or live models with no provider key), and the message a server throws is withheld from the browser
 * in production — so this points at the deployment check, which names the missing piece.
 */
export default function WorkspaceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-base font-semibold">Architect couldn&apos;t open this workspace.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The server stopped before the workspace could load. On a new deployment this is usually an incomplete
          configuration — the database or the model provider. The deployment check at{" "}
          <a className="underline underline-offset-2" href="/api/health">
            /api/health
          </a>{" "}
          reports which part is missing.
        </p>
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    </main>
  );
}
