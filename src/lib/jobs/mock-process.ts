import type { SupabaseClient } from "@supabase/supabase-js";
import { formatStorageClientError } from "@/lib/supabase/supabase-fetch";
import {
  formatBytesHuman,
  getMaxRenderUploadBytes,
  renderUploadErrorHint,
} from "@/lib/supabase/storage-limits";
import { uploadToRendersWithRetry } from "@/lib/supabase/render-storage-upload";
import { finalRenderStorageObjectPath } from "@/lib/storage/final-render-key";
import { mergeWizardMetadata } from "@/lib/wizard/metadata";

/**
 * Preview final export: copies only the **first** scene clip into `renders` (no FFmpeg).
 * Full multi-clip concat, voice, music, and captions require FFmpeg on the server — see `compose-video` / `ENABLE_COMPOSE`.
 */
async function finalizePreviewCompose(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Record<string, unknown>> {
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .single();

  if (projErr || !project) {
    return {
      note: "Compose — project not found.",
      finalUrl: null,
    };
  }

  const { data: clips, error: clipErr } = await supabase
    .from("project_assets")
    .select("storage_path")
    .eq("project_id", projectId)
    .eq("type", "video_clip")
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (clipErr) {
    return {
      note: `Compose — could not load clips: ${clipErr.message}`,
      finalUrl: null,
    };
  }

  if (!clips?.length) {
    return {
      note: "Compose — add scene clips before exporting.",
      finalUrl: null,
    };
  }

  const firstPath = clips[0]!.storage_path;
  const { data: blob, error: dlErr } = await supabase.storage
    .from("generated-video")
    .download(firstPath);

  if (dlErr || !blob) {
    return {
      note: `Compose — could not read clip: ${dlErr?.message ?? "download failed"}`,
      finalUrl: null,
    };
  }

  const userId = project.user_id;
  const outPath = finalRenderStorageObjectPath(userId, projectId);
  const buf = await blob.arrayBuffer();
  const maxUploadBytes = getMaxRenderUploadBytes();
  if (buf.byteLength > maxUploadBytes) {
    return {
      note:
        `Compose — final file is ${formatBytesHuman(buf.byteLength)} (max ${formatBytesHuman(maxUploadBytes)}). ` +
        "Raise Storage limit in Dashboard and RETOOL_MAX_RENDER_UPLOAD_BYTES, or shorten clips.",
      finalUrl: null,
    };
  }

  const { error: upErr } = await uploadToRendersWithRetry(
    supabase,
    outPath,
    () => new Uint8Array(buf),
    {
      contentType: "video/mp4",
      upsert: true,
    },
  );

  if (upErr) {
    const detail = formatStorageClientError(upErr);
    return {
      note:
        `Compose — could not upload final file: ${detail}.${renderUploadErrorHint(detail)}`,
      finalUrl: null,
    };
  }

  const { data: existing } = await supabase
    .from("project_assets")
    .select("id, storage_path")
    .eq("project_id", projectId)
    .eq("type", "final_render");

  for (const row of existing ?? []) {
    if (row.storage_path) {
      await supabase.storage
        .from("renders")
        .remove([row.storage_path])
        .catch(() => {});
    }
    await supabase.from("project_assets").delete().eq("id", row.id);
  }

  const { data: assetRow, error: assetErr } = await supabase
    .from("project_assets")
    .insert({
      project_id: projectId,
      type: "final_render",
      storage_path: outPath,
      mime_type: "video/mp4",
    })
    .select("id")
    .single();

  if (assetErr || !assetRow) {
    return {
      storage_path: outPath,
      note: assetErr?.message ?? "Failed to save final_render row.",
      finalUrl: null,
    };
  }

  const n = clips?.length ?? 0;
  return {
    note:
      n > 1
        ? `Export: only the first of ${n} clips was copied (FFmpeg not available or ENABLE_COMPOSE=0). Install ffmpeg on the server; leave ENABLE_COMPOSE unset for auto-detect, or set to 1 — then you get all clips, voice, music, and optional burned captions.`
        : "Export: single clip preview. Install ffmpeg for full concat, voice mux, music, and captions.",
    storage_path: outPath,
    final_asset_id: assetRow.id,
  };
}

/**
 * Synchronously completes a queued generation job with placeholder outputs (no external AI).
 */
export async function processSyncGenerationJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: job, error: fetchErr } = await supabase
    .from("generation_jobs")
    .select("id, project_id, kind, status, input")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return { ok: false, error: fetchErr?.message ?? "Job not found" };
  }
  if (job.status !== "queued" && job.status !== "running") {
    return { ok: true };
  }

  await supabase
    .from("generation_jobs")
    .update({ status: "running", provider: "mock" })
    .eq("id", jobId);

  const input = (job.input && typeof job.input === "object"
    ? job.input
    : {}) as Record<string, unknown>;

  let output: Record<string, unknown> = { mock: true, provider: "mock" };

  switch (job.kind) {
    case "script": {
      const draft =
        typeof input.scriptDraft === "string" && input.scriptDraft.trim()
          ? input.scriptDraft
          : `Welcome to your listing. This is placeholder copy for preview. ` +
            `Highlight square footage, recent updates, and neighborhood appeal. ` +
            `Replace this text anytime before final render.`;
      output = {
        ...output,
        script: draft,
        wordCount: draft.split(/\s+/).filter(Boolean).length,
      };
      break;
    }
    case "voice": {
      output = {
        ...output,
        durationMs: 18_000,
        preset: input.preset ?? "hope-female",
      };
      break;
    }
    case "music": {
      output = {
        ...output,
        durationMs: 20_000,
        preset: input.preset ?? "warm",
        prompt: input.prompt ?? "",
      };
      break;
    }
    case "scene_video": {
      output = { ...output, clipUrls: [], note: "Scene clips — no video bytes (add Fal credentials for real clips)." };
      break;
    }
    case "compose": {
      const previewFinal = await finalizePreviewCompose(supabase, job.project_id);
      output = { ...output, finalUrl: null, ...previewFinal };
      break;
    }
    default:
      output = { ...output, note: "Unknown kind" };
  }

  const { error: upErr } = await supabase
    .from("generation_jobs")
    .update({
      status: "succeeded",
      output,
      provider: "mock",
      progress: null,
    })
    .eq("id", jobId);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", job.project_id)
    .single();

  const meta = project?.metadata as Record<string, unknown> | null;

  if (job.kind === "script") {
    const script =
      typeof output.script === "string" ? output.script : "";
    await supabase
      .from("projects")
      .update({
        metadata: mergeWizardMetadata(meta, {
          scriptDraft: script,
          scriptMockReady: true,
        }),
      })
      .eq("id", job.project_id);
  }

  if (job.kind === "voice") {
    await supabase
      .from("projects")
      .update({
        metadata: mergeWizardMetadata(meta, {
          voiceMockReady: true,
          voiceDurationMs: 18_000,
        }),
      })
      .eq("id", job.project_id);
  }

  if (job.kind === "music") {
    const musicIn = input as { preset?: string; prompt?: string };
    await supabase
      .from("projects")
      .update({
        metadata: mergeWizardMetadata(meta, {
          musicMockReady: true,
          musicPreset: musicIn.preset ?? null,
          musicPrompt: musicIn.prompt ?? "",
          musicDurationMs: 20_000,
        }),
      })
      .eq("id", job.project_id);
  }

  return { ok: true };
}
