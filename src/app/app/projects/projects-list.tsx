"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clock, Home, Trash2 } from "lucide-react";
import { deleteProject } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProjectRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

type Props = {
  projects: ProjectRow[];
  coverUrls: Record<string, string>;
};

/** Strip trailing "Listing Video" (any casing) from display titles. */
function displayProjectTitle(raw: string): string {
  const t = raw.trim();
  const stripped = t.replace(/\s+listing\s+video\s*$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}

function statusPresentation(status: string): { label: string; className: string } {
  switch (status) {
    case "ready":
      return {
        label: "Completed",
        className: "font-medium text-[oklch(0.52_0.04_145)]",
      };
    case "processing":
    case "draft":
      return {
        label: "In progress",
        className: "font-medium text-[var(--app-accent)]",
      };
    case "failed":
      return {
        label: "Failed",
        className: "font-medium text-[var(--app-muted)]",
      };
    default:
      return {
        label: status,
        className: "font-medium text-[var(--app-muted)]",
      };
  }
}

export function ProjectsList({ projects, coverUrls }: Props) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onDelete = async (projectId: string, title: string) => {
    const label = title.trim() || "this project";
    if (
      !confirm(
        `Delete “${label}”? All photos, jobs, and data for this listing will be removed. This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(projectId);
    try {
      await deleteProject(projectId);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete project");
    } finally {
      setDeletingId(null);
    }
  };

  if (!projects.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)]/60 px-8 py-16 text-center">
        <Home
          className="mx-auto size-10 text-[color-mix(in_oklab,var(--app-accent)_35%,transparent)]"
          aria-hidden
        />
        <p className="mt-4 font-[family-name:var(--font-app-heading)] text-lg text-[var(--app-foreground)]">
          No projects yet
        </p>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          Use <span className="font-medium text-[var(--app-accent)]">Create New Project</span>{" "}
          above to start a listing video.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((p) => {
        const cover = coverUrls[p.id];
        const st = statusPresentation(p.status);
        const created = new Date(p.created_at);

        const cardTitle = displayProjectTitle(p.title);

        return (
          <li key={p.id} className="group relative">
            <Link
              href={`/app/projects/${p.id}/wizard/photos`}
              className={cn(
                "bg-[var(--app-card)] block rounded-2xl border border-[var(--app-border)] p-4 shadow-[0_4px_24px_-6px_rgba(35,28,22,0.12)] transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_10px_36px_-10px_rgba(35,28,22,0.16)]",
                deletingId === p.id && "pointer-events-none opacity-50",
              )}
            >
              <h2 className="font-[family-name:var(--font-app-heading)] mb-3 line-clamp-2 text-lg leading-snug font-semibold text-[var(--app-foreground)]">
                {cardTitle}
              </h2>

              <div className="bg-[color-mix(in_oklab,var(--app-canvas)_88%,white)] relative aspect-[16/10] overflow-hidden rounded-xl">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URLs
                  <img
                    src={cover}
                    alt=""
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Home
                      className="size-12 text-[color-mix(in_oklab,var(--app-accent)_25%,transparent)]"
                      aria-hidden
                    />
                  </div>
                )}
              </div>

              <p className="mt-3 flex flex-wrap items-center gap-x-1 text-xs text-[var(--app-muted)]">
                <Clock className="mr-0.5 size-3.5 shrink-0 stroke-[1.25]" aria-hidden />
                <span>
                  Created:{" "}
                  {created.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="mx-0.5" aria-hidden>
                  ·
                </span>
                <span>Status: </span>
                <span className={cn(st.className)}>{st.label}</span>
              </p>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 size-9 rounded-full border border-[var(--app-border)] bg-[var(--app-card)]/95 text-[var(--app-muted)] opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-[var(--app-card)] hover:text-destructive group-hover:opacity-100"
              disabled={deletingId !== null}
              aria-label={`Delete ${cardTitle}`}
              onClick={(e) => {
                e.preventDefault();
                void onDelete(p.id, p.title);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
