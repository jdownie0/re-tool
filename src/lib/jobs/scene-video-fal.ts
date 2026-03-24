import { fal } from "@fal-ai/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SECONDS_PER_SCENE } from "@/lib/wizard/constants";

const DEFAULT_MODEL = "fal-ai/kling-video/v2.1/standard/image-to-video";

function getSceneVideoModel(): string {
  return (
    process.env.FAL_SCENE_VIDEO_MODEL?.trim() || DEFAULT_MODEL
  );
}

function useMockVideo(): boolean {
  const v = process.env.USE_MOCK_VIDEO?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldProcessSceneVideoWithFal(): boolean {
  if (useMockVideo()) return false;
  return Boolean(process.env.FAL_AI_KEY?.trim());
}

type SceneVideoInput = {
  photo_asset_id?: string;
  storage_path?: string;
  scene_index?: number;
  prompt?: string;
  duration_sec?: number;
};

/**
 * Runs Fal image-to-video, uploads MP4 to `generated-video`, inserts `project_assets` (video_clip).
 */
export async function processSceneVideoWithFal(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.FAL_AI_KEY?.trim();
  if (!key) {
    return { ok: false, error: "FAL_AI_KEY is not configured." };
  }

  const { data: job, error: fetchErr } = await supabase
    .from("generation_jobs")
    .select("id, project_id, kind, status, input")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job || job.kind !== "scene_video") {
    return { ok: false, error: fetchErr?.message ?? "Job not found" };
  }
  if (job.status !== "queued" && job.status !== "running") {
    return { ok: true };
  }

  const input = (job.input && typeof job.input === "object"
    ? job.input
    : {}) as SceneVideoInput;

  const photoAssetId =
    typeof input.photo_asset_id === "string" ? input.photo_asset_id : null;
  const storagePath =
    typeof input.storage_path === "string" ? input.storage_path : null;
  const sceneIndex =
    typeof input.scene_index === "number" && Number.isFinite(input.scene_index)
      ? input.scene_index
      : 0;
  const prompt =
    typeof input.prompt === "string" && input.prompt.trim()
      ? input.prompt.trim()
      : "Smooth, cinematic camera movement showcasing this real estate interior.";

  if (!photoAssetId || !storagePath) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: "Missing photo_asset_id or storage_path in job input.",
      })
      .eq("id", jobId);
    return { ok: false, error: "Invalid scene_video job input." };
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", job.project_id)
    .single();

  if (projErr || !project) {
    return { ok: false, error: "Project not found" };
  }

  const userId = project.user_id;

  await supabase
    .from("generation_jobs")
    .update({ status: "running", provider: "fal", error: null })
    .eq("id", jobId);

  const { data: signed, error: signErr } = await supabase.storage
    .from("listing-photos")
    .createSignedUrl(storagePath, 60 * 60);

  if (signErr || !signed?.signedUrl) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        error: signErr?.message ?? "Could not sign listing photo URL.",
      })
      .eq("id", jobId);
    return { ok: false, error: signErr?.message ?? "Could not sign photo URL." };
  }

  fal.config({ credentials: key });

  const model = getSceneVideoModel();
  const durationLabel: "5" | "10" =
    typeof input.duration_sec === "number" && input.duration_sec > 6 ? "10" : "5";

  let videoUrl: string;
  try {
    const result = (await fal.subscribe(model, {
      input: {
        prompt,
        image_url: signed.signedUrl,
        duration: durationLabel,
      },
    })) as { video?: { url?: string } };

    const url = result.video?.url;
    if (!url || typeof url !== "string") {
      throw new Error("Fal response did not include a video URL.");
    }
    videoUrl = url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: msg.slice(0, 2000),
      })
      .eq("id", jobId);
    return { ok: false, error: msg };
  }

  let videoBytes: ArrayBuffer;
  try {
    const vidRes = await fetch(videoUrl);
    if (!vidRes.ok) {
      throw new Error(`Failed to download video (${vidRes.status})`);
    }
    videoBytes = await vidRes.arrayBuffer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: msg.slice(0, 2000),
      })
      .eq("id", jobId);
    return { ok: false, error: msg };
  }

  const outPath = `${userId}/${job.project_id}/clips/scene-${photoAssetId}.mp4`;

  const { data: existingClip } = await supabase
    .from("project_assets")
    .select("id")
    .eq("project_id", job.project_id)
    .eq("type", "video_clip")
    .eq("storage_path", outPath)
    .maybeSingle();

  if (existingClip?.id) {
    await supabase.from("project_assets").delete().eq("id", existingClip.id);
  }

  const { error: upErr } = await supabase.storage
    .from("generated-video")
    .upload(outPath, new Uint8Array(videoBytes), {
      contentType: "video/mp4",
      upsert: true,
    });

  if (upErr) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: upErr.message,
      })
      .eq("id", jobId);
    return { ok: false, error: upErr.message };
  }

  const durationMs =
    durationLabel === "10" ? 10_000 : Math.max(4000, SECONDS_PER_SCENE * 1000);

  const { data: assetRow, error: assetErr } = await supabase
    .from("project_assets")
    .insert({
      project_id: job.project_id,
      type: "video_clip",
      storage_path: outPath,
      mime_type: "video/mp4",
      sort_order: sceneIndex,
      duration_ms: durationMs,
    })
    .select("id")
    .single();

  if (assetErr || !assetRow) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: assetErr?.message ?? "Failed to save clip asset.",
      })
      .eq("id", jobId);
    return { ok: false, error: assetErr?.message ?? "Failed to save clip asset." };
  }

  const output = {
    provider: "fal",
    model,
    video_url: videoUrl,
    storage_path: outPath,
    clip_asset_id: assetRow.id,
    photo_asset_id: photoAssetId,
    scene_index: sceneIndex,
    duration_ms: durationMs,
  };

  const { error: finErr } = await supabase
    .from("generation_jobs")
    .update({
      status: "succeeded",
      provider: "fal",
      output,
      error: null,
    })
    .eq("id", jobId);

  if (finErr) {
    return { ok: false, error: finErr.message };
  }

  return { ok: true };
}
