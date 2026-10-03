import "./globals.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { projectDefinition } from "@/projects/registry";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

/** Named after whichever project this server serves; resolution is pure configuration, so no database is opened. */
export function generateMetadata(): Metadata {
  let project: string | null = null;
  try {
    project = projectDefinition().name;
  } catch {
    // A misconfigured ARCHITECT_PROJECT is reported by /api/health; the page still needs a title.
  }
  return {
    title: project ? `Architect · ${project}` : "Architect",
    description: "Scenarios that verify agent behavior after every change.",
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans antialiased", geist.variable, geistMono.variable)}>
      <body suppressHydrationWarning>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
