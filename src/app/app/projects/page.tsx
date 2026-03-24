import { createClient } from "@/lib/supabase/server";
import { ProjectsList } from "./projects-list";

type PhotoRow = {
  project_id: string;
  storage_path: string;
  sort_order: number | null;
  created_at: string;
};

function pickFirstPhotoPerProject(rows: PhotoRow[]): Map<string, string> {
  const sorted = [...rows].sort((a, b) => {
    const sa = a.sort_order ?? 10_000;
    const sb = b.sort_order ?? 10_000;
    if (sa !== sb) return sa - sb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const map = new Map<string, string>();
  for (const row of sorted) {
    if (!map.has(row.project_id)) {
      map.set(row.project_id, row.storage_path);
    }
  }
  return map;
}

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

  const list = projects ?? [];
  const projectIds = list.map((p) => p.id);

  const coverUrls: Record<string, string> = {};

  if (projectIds.length > 0) {
    const { data: photos } = await supabase
      .from("project_assets")
      .select("project_id, storage_path, sort_order, created_at")
      .in("project_id", projectIds)
      .eq("type", "photo");

    const firstPaths = pickFirstPhotoPerProject((photos ?? []) as PhotoRow[]);
    await Promise.all(
      [...firstPaths.entries()].map(async ([projectId, storagePath]) => {
        const { data } = await supabase.storage
          .from("listing-photos")
          .createSignedUrl(storagePath, 3600);
        if (data?.signedUrl) {
          coverUrls[projectId] = data.signedUrl;
        }
      }),
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 pb-4">
      <header>
        <h1 className="font-[family-name:var(--font-app-heading)] text-4xl font-semibold tracking-tight text-[var(--app-foreground)] md:text-5xl">
          Videos
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--app-muted)]">
          Open a listing to continue your video, or create a new video.
        </p>
      </header>

      <ProjectsList projects={list} coverUrls={coverUrls} />
    </div>
  );
}
