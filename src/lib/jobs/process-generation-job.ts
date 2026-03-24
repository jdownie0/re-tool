import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processComposeVideo,
  shouldProcessComposeWithFfmpeg,
} from "@/lib/jobs/compose-video";
import { processSyncGenerationJob } from "@/lib/jobs/mock-process";
import {
  processSceneVideoWithFal,
  shouldProcessSceneVideoWithFal,
} from "@/lib/jobs/scene-video-fal";

/**
 * Completes a generation job: placeholder processor by default, Fal for `scene_video` when configured,
 * FFmpeg compose when `ENABLE_COMPOSE` is set.
 */
export async function processGenerationJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select("id, kind")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }

  if (job.kind === "scene_video" && shouldProcessSceneVideoWithFal()) {
    return processSceneVideoWithFal(supabase, jobId);
  }

  if (job.kind === "compose" && shouldProcessComposeWithFfmpeg()) {
    return processComposeVideo(supabase, jobId);
  }

  return processSyncGenerationJob(supabase, jobId);
}
