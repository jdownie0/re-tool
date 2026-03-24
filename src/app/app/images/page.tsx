import Link from "next/link";
import { Clock, Home, Images } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = {
  id: string;
  title: string;
  created_at: string;
};

type SnapshotRow = {
  project_id: string;
  address: string | null;
  created_at: string;
};

type PhotoAssetRow = {
  id: string;
  project_id: string;
  storage_path: string;
  sort_order: number | null;
  created_at: string;
};

function displayProjectTitle(raw: string): string {
  const t = raw.trim();
  const stripped = t.replace(/\s+listing\s+video\s*$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}

export default async function ImagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  const projectRows = (projects ?? []) as ProjectRow[];
  const projectIds = projectRows.map((p) => p.id);

  const groups: Array<{
    projectId: string;
    label: string;
    createdAt: string;
    photoCount: number;
    coverUrl: string | null;
  }> = [];

  if (projectIds.length > 0) {
    const [{ data: snapshots }, { data: photoAssets }] = await Promise.all([
      supabase
        .from("listing_snapshots")
        .select("project_id, address, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("project_assets")
        .select("id, project_id, storage_path, sort_order, created_at")
        .in("project_id", projectIds)
        .eq("type", "photo"),
    ]);

    const addressByProjectId = new Map<string, string>();
    for (const row of (snapshots ?? []) as SnapshotRow[]) {
      const addr = row.address?.trim();
      if (addr && !addressByProjectId.has(row.project_id)) {
        addressByProjectId.set(row.project_id, addr);
      }
    }

    const projectById = new Map(projectRows.map((p) => [p.id, p] as const));
    const photosByProject = new Map<string, PhotoAssetRow[]>();
    for (const row of (photoAssets ?? []) as PhotoAssetRow[]) {
      const list = photosByProject.get(row.project_id) ?? [];
      list.push(row);
      photosByProject.set(row.project_id, list);
    }

    for (const projectId of projectIds) {
      const rows = photosByProject.get(projectId) ?? [];
      if (rows.length === 0) continue;

      rows.sort((a, b) => {
        const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      const coverPath = rows[0]?.storage_path ?? null;
      let coverUrl: string | null = null;
      if (coverPath) {
        const { data } = await supabase.storage
          .from("listing-photos")
          .createSignedUrl(coverPath, 3600);
        coverUrl = data?.signedUrl ?? null;
      }

      const project = projectById.get(projectId);
      const fallback = project ? displayProjectTitle(project.title) : "Untitled listing";
      if (!project) continue;
      groups.push({
        projectId,
        label: addressByProjectId.get(projectId) ?? fallback,
        createdAt: project.created_at,
        photoCount: rows.length,
        coverUrl,
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 pb-4">
      <header>
        <h1 className="font-[family-name:var(--font-app-heading)] text-4xl font-semibold tracking-tight text-[var(--app-foreground)] md:text-5xl">
          Images
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--app-muted)]">
          Source photos uploaded to videos are listed here automatically and grouped by listing
          address. Open a group to view its image gallery.
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)]/60 px-8 py-16 text-center">
          <Home
            className="mx-auto size-10 text-[color-mix(in_oklab,var(--app-accent)_35%,transparent)]"
            aria-hidden
          />
          <p className="mt-4 font-[family-name:var(--font-app-heading)] text-lg text-[var(--app-foreground)]">
            No images yet
          </p>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            Upload listing photos in the video wizard and they will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((group) => {
            const created = new Date(group.createdAt);
            return (
              <li key={group.projectId}>
                <Link
                  href={`/app/images/${group.projectId}`}
                  className="bg-[var(--app-card)] block rounded-2xl border border-[var(--app-border)] p-4 shadow-[0_4px_24px_-6px_rgba(35,28,22,0.12)] transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_10px_36px_-10px_rgba(35,28,22,0.16)]"
                >
                  <h2 className="font-[family-name:var(--font-app-heading)] mb-3 line-clamp-2 text-lg leading-snug font-semibold text-[var(--app-foreground)]">
                    {group.label}
                  </h2>

                  <div className="bg-[color-mix(in_oklab,var(--app-canvas)_88%,white)] relative aspect-[16/10] overflow-hidden rounded-xl">
                    {group.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URLs
                      <img
                        src={group.coverUrl}
                        alt=""
                        className="size-full object-cover transition-transform duration-500 hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Images
                          className="size-12 text-[color-mix(in_oklab,var(--app-accent)_25%,transparent)]"
                          aria-hidden
                        />
                      </div>
                    )}
                  </div>

                  <p className="mt-3 flex flex-nowrap items-center gap-x-1 whitespace-nowrap text-xs text-[var(--app-muted)]">
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
                    <span>{group.photoCount} images</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
