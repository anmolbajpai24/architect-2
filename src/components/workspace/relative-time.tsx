"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "./format";

/** "12s ago", refreshed every 10s. Server and client clocks differ, so the first paint tolerates a mismatch. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {timeAgo(iso, now)}
    </time>
  );
}
