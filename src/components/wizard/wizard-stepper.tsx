"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/lib/wizard/types";
import { WIZARD_STEPS } from "@/lib/wizard/types";

const LABELS: Record<WizardStep, string> = {
  photos: "Photos & listing",
  voiceover: "Voiceover",
  arrange: "Arrange",
  music: "Music",
  review: "Review",
};

const EXPORT_LABEL = "Share";

type Props = {
  projectId: string;
};

export function WizardStepper({ projectId }: Props) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}/wizard`;
  const exportHref = `${base}/export`;
  const onExport = pathname === exportHref || pathname.endsWith("/wizard/export");

  return (
    <nav
      aria-label="Listing video steps"
    >
      <ol className="mx-auto grid w-[80%] grid-cols-3 gap-x-1 sm:grid-cols-6 sm:gap-x-2">
        {WIZARD_STEPS.map((step) => {
          const href = `${base}/${step}`;
          const active = pathname === href || pathname.endsWith(`/${step}`);
          return (
            <li key={step} className="flex">
              <Link
                href={href}
                className={cn(
                  "text-muted-foreground inline-flex w-full items-center justify-center border-b-2 border-[var(--app-border)] px-2 py-3.5 text-center text-base leading-none font-medium transition-colors hover:text-[var(--app-accent)]",
                  active &&
                    "border-[var(--app-accent)] text-[var(--app-accent)]",
                )}
              >
                {LABELS[step]}
              </Link>
            </li>
          );
        })}
        <li className="flex">
          <Link
            href={exportHref}
            className={cn(
              "text-muted-foreground inline-flex w-full items-center justify-center border-b-2 border-[var(--app-border)] px-2 py-3.5 text-center text-base leading-none font-medium transition-colors hover:text-[var(--app-accent)]",
              onExport && "border-[var(--app-accent)] text-[var(--app-accent)]",
            )}
          >
            {EXPORT_LABEL}
          </Link>
        </li>
      </ol>
    </nav>
  );
}
