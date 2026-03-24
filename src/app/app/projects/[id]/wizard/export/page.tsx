import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExportShareView } from "@/components/wizard/export-share-view";
import { getWizardFromMetadata } from "@/lib/wizard/metadata";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function WizardExportPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    notFound();
  }

  const wizard = getWizardFromMetadata(
    project.metadata as Record<string, unknown> | null,
  );

  const { data: finalRenderAsset } = await supabase
    .from("project_assets")
    .select("storage_path")
    .eq("project_id", project.id)
    .eq("type", "final_render")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let finalRenderUrl: string | null = null;
  if (finalRenderAsset?.storage_path) {
    const { data: signed } = await supabase.storage
      .from("renders")
      .createSignedUrl(finalRenderAsset.storage_path, 3600);
    finalRenderUrl = signed?.signedUrl ?? null;
  }

  if (!finalRenderUrl) {
    const { data: composeJobRow } = await supabase
      .from("generation_jobs")
      .select("output")
      .eq("project_id", project.id)
      .eq("kind", "compose")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const out = composeJobRow?.output as Record<string, unknown> | null;
    if (typeof out?.storage_path === "string" && out.storage_path.length > 0) {
      const { data: signed } = await supabase.storage
        .from("renders")
        .createSignedUrl(out.storage_path, 3600);
      finalRenderUrl = signed?.signedUrl ?? null;
    }
  }

  return (
    <ExportShareView
      projectId={project.id}
      projectTitle={project.title}
      initialVideoUrl={finalRenderUrl}
      initialDescription={wizard.scriptDraft.trim() || project.title}
    />
  );
}
