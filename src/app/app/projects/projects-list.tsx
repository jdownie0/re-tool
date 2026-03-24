"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteProject } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ProjectRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

type Props = {
  projects: ProjectRow[];
};

export function ProjectsList({ projects }: Props) {
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
      <p className="text-muted-foreground text-sm">
        No projects yet. Create one to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {projects.map((p) => (
        <li key={p.id} className="flex items-stretch gap-2">
          <Link
            href={`/app/projects/${p.id}/wizard/photos`}
            className={cn(
              "min-w-0 flex-1",
              deletingId === p.id && "pointer-events-none opacity-50",
            )}
          >
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader className="py-4">
                <CardTitle className="text-base">{p.title}</CardTitle>
                <CardDescription>
                  {p.status} · {new Date(p.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="text-muted-foreground hover:text-destructive shrink-0 self-center"
            disabled={deletingId !== null}
            aria-label={`Delete ${p.title}`}
            onClick={() => void onDelete(p.id, p.title)}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
