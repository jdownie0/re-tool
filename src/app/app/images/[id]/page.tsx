import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

type PhotoAssetRow = {
  id: string;
  project_id: string;
  storage_path: string;
  sort_order: number | null;
  created_at: string;
};

type SnapshotRow = {
  address: string | null;
};

function displayProjectTitle(raw: string): string {
  const t = raw.trim();
  const stripped = t.replace(/\s+listing\s+video\s*$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}

export default async function ImagesGroupPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", id)
    .eq("user_id", user!.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: snapshot }, { data: photoAssets }] = await Promise.all([
    supabase
      .from("listing_snapshots")
      .select("address")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_assets")
      .select("id, project_id, storage_path, sort_order, created_at")
      .eq("project_id", id)
      .eq("type", "photo"),
  ]);

  const rows = (photoAssets ?? []) as PhotoAssetRow[];
  rows.sort((a, b) => {
    const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const photos = await Promise.all(
    rows.map(async (row) => {
      const { data } = await supabase.storage
        .from("listing-photos")
        .createSignedUrl(row.storage_path, 3600);
      return data?.signedUrl ? { id: row.id, url: data.signedUrl } : null;
    }),
  );

  const imageRows = photos.filter((p): p is { id: string; url: string } => p !== null);
  const address = (snapshot as SnapshotRow | null)?.address?.trim();
  const groupLabel = address || displayProjectTitle(project.title);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-4">
      <header className="space-y-2">
        <h1 className="font-[family-name:var(--font-app-heading)] text-4xl font-semibold tracking-tight text-[var(--app-foreground)] md:text-5xl">
          {groupLabel}
        </h1>
        <p className="text-sm text-[var(--app-muted)]">{imageRows.length} images</p>
      </header>

      {imageRows.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {imageRows.map((photo) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-[var(--app-border)]">
              <Link href={`/app/images/${id}/${photo.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt=""
                  className="aspect-square w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--app-muted)]">No images found for this listing yet.</p>
      )}

      <div className="pt-1">
        <Link href="/app/images" className={cn(buttonVariants({ variant: "outline" }))}>
          ← All image groups
        </Link>
      </div>
    </div>
  );
}
