import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { createProject } from "@/app/app/actions";
import { ProjectsList } from "./projects-list";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Listing video projects map to rows in{" "}
            <code className="rounded bg-muted px-1 py-0.5">projects</code>.
          </p>
        </div>
        <form action={createProject}>
          <Button type="submit">New project</Button>
        </form>
      </div>

      <ProjectsList projects={projects ?? []} />
    </div>
  );
}
