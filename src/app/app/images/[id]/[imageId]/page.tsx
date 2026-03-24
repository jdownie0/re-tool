import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ id: string; imageId: string }>;
};

type SnapshotRow = {
  address: string | null;
};

function displayProjectTitle(raw: string): string {
  const t = raw.trim();
  const stripped = t.replace(/\s+listing\s+video\s*$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}

export default async function ImageDetailPage({ params }: Props) {
  const { id, imageId } = await params;
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

  const [{ data: snapshot }, { data: photo }] = await Promise.all([
    supabase
      .from("listing_snapshots")
      .select("address")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_assets")
      .select("id, project_id, storage_path")
      .eq("id", imageId)
      .eq("project_id", id)
      .eq("type", "photo")
      .maybeSingle(),
  ]);

  if (!photo?.storage_path) {
    notFound();
  }

  const { data: signed } = await supabase.storage
    .from("listing-photos")
    .createSignedUrl(photo.storage_path, 3600);

  const imageUrl = signed?.signedUrl;
  if (!imageUrl) {
    notFound();
  }

  const address = (snapshot as SnapshotRow | null)?.address?.trim();
  const groupLabel = address || displayProjectTitle(project.title);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-4">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-app-heading)] text-3xl font-semibold tracking-tight text-[var(--app-foreground)] md:text-4xl">
          {groupLabel}
        </h1>
        <p className="text-sm text-[var(--app-muted)]">Image preview</p>
      </header>

      <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="mx-auto max-h-[75vh] w-auto max-w-full rounded-xl object-contain" />
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        <Link href={`/app/images/${id}`} className={cn(buttonVariants({ variant: "outline" }))}>
          ← Back to group
        </Link>
        <Link href="/app/images" className={cn(buttonVariants({ variant: "ghost" }))}>
          All image groups
        </Link>
      </div>
    </div>
  );
}
