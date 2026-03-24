import { ApiError, fal } from "@fal-ai/client";
import type { QueueStatus, StorageSettings } from "@fal-ai/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JOB_PROGRESS_STAGES,
  updateJobProgress,
} from "@/lib/jobs/job-progress";
import { SECONDS_PER_SCENE } from "@/lib/wizard/constants";

/** Fal client errors include HTTP status, JSON body, and x-fal-request-id — not just `message`. */
function formatFalClientError(e: unknown): string {
  if (e instanceof ApiError) {
    const parts: string[] = [];
    parts.push(e.message || "Fal API error");
    parts.push(`HTTP ${e.status}`);
    if (e.requestId) {
      parts.push(`fal_request_id=${e.requestId}`);
    }
    if (e.body !== undefined && e.body !== null) {
      const detail =
        typeof e.body === "string" ? e.body : JSON.stringify(e.body);
      if (detail && detail !== "{}") {
        parts.push(detail.slice(0, 1800));
      }
    }
    return parts.join(" — ");
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * `fal.subscribe()` resolves to `{ data: <model output>, requestId }` — not the output at the top level.
 * @see https://fal.ai/models/fal-ai/kling-video/v2.1/standard/image-to-video/api
 */
function extractFalVideoUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const r = result as Record<string, unknown>;
  const data = r.data;
  if (data && typeof data === "object") {
    const video = (data as { video?: { url?: unknown } }).video;
    const u = video?.url;
    if (typeof u === "string" && u.length > 0) {
      return u;
    }
  }
  const legacy = (r as { video?: { url?: unknown } }).video?.url;
  if (typeof legacy === "string" && legacy.length > 0) {
    return legacy;
  }
  return null;
}

function describeFalResultForError(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }
  const r = result as Record<string, unknown>;
  const top = Object.keys(r).join(",");
  const data = r.data;
  const dataKeys =
    data && typeof data === "object" ? Object.keys(data as object).join(",") : "";
  return `keys=[${top}]${dataKeys ? ` data.keys=[${dataKeys}]` : ""}`;
}

const DEFAULT_MODEL = "fal-ai/kling-video/v2.1/standard/image-to-video";

/**
 * Image-to-video models can still hallucinate; we bias toward fidelity with prompt + negative_prompt.
 * Override defaults with FAL_SCENE_VIDEO_PROMPT / FAL_SCENE_VIDEO_NEGATIVE_PROMPT / FAL_SCENE_VIDEO_CFG_SCALE.
 */
const DEFAULT_SCENE_PROMPT =
  "Photorealistic real estate clip. Keep the scene identical to the listing photo: same single room, " +
  "same walls, ceiling, floor, windows, doors, and furniture. Only very subtle slow camera movement " +
  "(gentle parallax or slow push-in). No walking through walls, no new rooms or hallways, no extra " +
  "doorways or openings, no adjacent spaces, no new furniture or decor, no layout changes, no morphing " +
  "architecture, no revealing what is outside the frame.";

const DEFAULT_SCENE_NEGATIVE_PROMPT =
  "new room, extra room, adjacent room, hallway appearing, new hallway, new doorway, door opening to " +
  "another space, new window, new opening, floor plan change, layout change, morphing walls, melting walls, " +
  "warped architecture, duplicate furniture, new furniture, new objects, new appliances, people, faces, " +
  "text, watermark, fisheye, cartoon, illustration, blur, distortion, low quality";

function buildSceneVideoPrompt(jobPrompt: string): string {
  const custom = jobPrompt.trim();
  if (!custom) {
    return process.env.FAL_SCENE_VIDEO_PROMPT?.trim() || DEFAULT_SCENE_PROMPT;
  }
  const prefix =
    "Strictly preserve the source photograph: same room and layout, no new spaces or objects. ";
  return `${prefix}${custom}`;
}

function buildSceneVideoNegativePrompt(): string {
  return (
    process.env.FAL_SCENE_VIDEO_NEGATIVE_PROMPT?.trim() || DEFAULT_SCENE_NEGATIVE_PROMPT
  );
}

/**
 * How long Fal keeps output files on fal.media (URLs like v3.fal.media/...).
 * @see https://docs.fal.ai/documentation/model-apis/media-expiration
 */
function getFalGeneratedMediaStorageSettings(): StorageSettings {
  const raw = process.env.FAL_OUTPUT_MEDIA_EXPIRES_IN?.trim();
  if (!raw) {
    return { expiresIn: "30d" };
  }
  const lower = raw.toLowerCase();
  const presets = new Set([
    "never",
    "immediate",
    "1h",
    "1d",
    "7d",
    "30d",
    "1y",
  ]);
  if (presets.has(lower)) {
    return { expiresIn: lower as StorageSettings["expiresIn"] };
  }
  const sec = Number.parseInt(raw, 10);
  if (Number.isFinite(sec) && sec > 0) {
    return { expiresIn: sec };
  }
  return { expiresIn: "30d" };
}

function getSceneVideoCfgScale(): number {
  const raw = process.env.FAL_SCENE_VIDEO_CFG_SCALE?.trim();
  if (!raw) {
    return 0.45;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0.1 || n > 2) {
    return 0.45;
  }
  return n;
}

function getSceneVideoModel(): string {
  return (
    process.env.FAL_SCENE_VIDEO_MODEL?.trim() || DEFAULT_MODEL
  );
}

function isMockVideoForcedEnv(): boolean {
  const v = process.env.USE_MOCK_VIDEO?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldProcessSceneVideoWithFal(): boolean {
  if (isMockVideoForcedEnv()) return false;
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
    .select("id, project_id, kind, status, input, output")
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
  const prompt = buildSceneVideoPrompt(
    typeof input.prompt === "string" ? input.prompt : "",
  );
  const negativePrompt = buildSceneVideoNegativePrompt();
  const cfgScale = getSceneVideoCfgScale();

  if (!photoAssetId || !storagePath) {
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: "Missing photo_asset_id or storage_path in job input.",
        progress: null,
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

  const priorOut =
    job.output && typeof job.output === "object"
      ? (job.output as Record<string, unknown>)
      : null;
  const reusedFalUrl =
    typeof priorOut?.fal_video_url === "string" && priorOut.fal_video_url.trim().length > 0
      ? priorOut.fal_video_url.trim()
      : "";

  const model = getSceneVideoModel();
  const durationLabel: "5" | "10" =
    typeof input.duration_sec === "number" && input.duration_sec > 6 ? "10" : "5";

  await supabase
    .from("generation_jobs")
    .update({
      status: "running",
      provider: "fal",
      error: null,
      progress: {
        stage: JOB_PROGRESS_STAGES.fal_generating,
        label: "Generating video",
        percent: reusedFalUrl ? 60 : 12,
      },
    })
    .eq("id", jobId);

  let videoUrl: string;

  if (reusedFalUrl) {
    /** Fal already billed; only retry download → storage → asset (no second Fal call). */
    videoUrl = reusedFalUrl;
  } else {
    const { data: signed, error: signErr } = await supabase.storage
      .from("listing-photos")
      .createSignedUrl(storagePath, 60 * 60);

    if (signErr || !signed?.signedUrl) {
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error: signErr?.message ?? "Could not sign listing photo URL.",
          progress: null,
        })
        .eq("id", jobId);
      return { ok: false, error: signErr?.message ?? "Could not sign photo URL." };
    }

    fal.config({ credentials: key });

    const onQueueUpdate = (status: QueueStatus) => {
      if (status.status === "IN_QUEUE") {
        void updateJobProgress(supabase, jobId, {
          stage: JOB_PROGRESS_STAGES.fal_generating,
          percent: 18,
        });
      } else if (status.status === "IN_PROGRESS") {
        void updateJobProgress(supabase, jobId, {
          stage: JOB_PROGRESS_STAGES.fal_generating,
          percent: 42,
        });
      }
    };

    try {
      const result = await fal.subscribe(model, {
        input: {
          prompt,
          negative_prompt: negativePrompt,
          cfg_scale: cfgScale,
          image_url: signed.signedUrl,
          duration: durationLabel,
        },
        storageSettings: getFalGeneratedMediaStorageSettings(),
        onQueueUpdate,
      });

      const url = extractFalVideoUrl(result);
      if (!url) {
        throw new Error(
          `Fal response did not include data.video.url (${describeFalResultForError(result)}).`,
        );
      }
      videoUrl = url;

      await supabase
        .from("generation_jobs")
        .update({
          output: {
            fal_video_url: videoUrl,
            fal_model: model,
            stage: "pending_download",
          },
          progress: {
            stage: JOB_PROGRESS_STAGES.downloading,
            label: "Downloading rendered clip",
            percent: 68,
          },
        })
        .eq("id", jobId);
    } catch (e) {
      const msg = formatFalClientError(e);
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          provider: "fal",
          error: msg.slice(0, 2000),
          progress: null,
        })
        .eq("id", jobId);
      return { ok: false, error: msg };
    }
  }

  await updateJobProgress(supabase, jobId, {
    stage: JOB_PROGRESS_STAGES.downloading,
    percent: 68,
  });

  let videoBytes: ArrayBuffer;
  try {
    const vidRes = await fetch(videoUrl);
    if (!vidRes.ok) {
      const errText = await vidRes.text().catch(() => "");
      throw new Error(
        `Failed to download video (HTTP ${vidRes.status}${errText ? `: ${errText.slice(0, 400)}` : ""})`,
      );
    }
    videoBytes = await vidRes.arrayBuffer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : formatFalClientError(e);
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "fal",
        error: msg.slice(0, 2000),
        progress: null,
      })
      .eq("id", jobId);
    return { ok: false, error: msg };
  }

  await updateJobProgress(supabase, jobId, {
    stage: JOB_PROGRESS_STAGES.uploading,
    percent: 82,
  });

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
        progress: null,
        output: {
          fal_video_url: videoUrl,
          fal_model: model,
          stage: "pending_upload",
        },
      })
      .eq("id", jobId);
    return { ok: false, error: upErr.message };
  }

  await updateJobProgress(supabase, jobId, {
    stage: JOB_PROGRESS_STAGES.finalizing,
    percent: 94,
  });

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
        progress: null,
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
      progress: null,
    })
    .eq("id", jobId);

  if (finErr) {
    return { ok: false, error: finErr.message };
  }

  return { ok: true };
}
