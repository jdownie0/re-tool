"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/lib/wizard/types";
import { WIZARD_STEPS } from "@/lib/wizard/types";

const LABELS: Record<WizardStep, string> = {
  photos: "Photos",
  voiceover: "Voiceover",
  arrange: "Arrange",
  music: "Music",
  review: "Review",
};

type Props = {
  projectId: string;
};

export function WizardStepper({ projectId }: Props) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}/wizard`;

  return (
    <nav
      className="border-b"
      aria-label="Listing video steps"
    >
      <ol className="flex flex-wrap gap-1 sm:gap-6">
        {WIZARD_STEPS.map((step) => {
          const href = `${base}/${step}`;
          const active = pathname === href || pathname.endsWith(`/${step}`);
          return (
            <li key={step}>
              <Link
                href={href}
                className={cn(
                  "text-muted-foreground inline-block border-b-2 border-transparent px-1 py-3 text-sm font-medium transition-colors",
                  active &&
                    "text-foreground border-foreground",
                )}
              >
                {LABELS[step]}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
