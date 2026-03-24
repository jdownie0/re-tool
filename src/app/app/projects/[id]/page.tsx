import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EditableProjectTitle } from "@/components/editable-project-title";

type Props = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, status, listing_url, duration_seconds, metadata, created_at")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="space-y-1">
        <EditableProjectTitle
          projectId={project.id}
          initialTitle={project.title}
          variant="pageHeading"
        />
        <p className="text-muted-foreground text-sm">Project ID: {project.id}</p>
      </div>

      <Link
        href={`/app/projects/${project.id}/wizard/photos`}
        className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
      >
        Open listing video wizard
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Raw project row (wizard state lives in metadata).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Status: </span>
            {project.status}
          </p>
          <p>
            <span className="text-muted-foreground">Listing URL: </span>
            {project.listing_url ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Duration (seconds): </span>
            {project.duration_seconds ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Metadata: </span>
            <code className="rounded bg-muted px-1 py-0.5 text-xs break-all">
              {JSON.stringify(project.metadata)}
            </code>
          </p>
        </CardContent>
      </Card>

      <Link href="/app/projects" className={cn(buttonVariants({ variant: "outline" }))}>
        ← All projects
      </Link>
    </div>
  );
}
