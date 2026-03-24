import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persisted on `generation_jobs.progress` (jsonb).
 * `percent` is 0–100 when known; omit or null for indeterminate segments.
 */
export type GenerationJobProgress = {
  stage: string;
  /** Human-readable line for the UI; optional if the client maps `stage`. */
  label?: string;
  /** 0–100 when the worker can estimate; null/omit = indeterminate bar. */
  percent?: number | null;
};

export const JOB_PROGRESS_STAGES = {
  queued: "queued",
  fal_generating: "fal_generating",
  downloading: "downloading",
  aligning: "aligning",
  composing: "composing",
  burning_subtitles: "burning_subtitles",
  muxing: "muxing",
  uploading: "uploading",
  finalizing: "finalizing",
} as const;

export function stageLabel(stage: string): string {
  switch (stage) {
    case JOB_PROGRESS_STAGES.queued:
      return "Queued";
    case JOB_PROGRESS_STAGES.fal_generating:
      return "Generating video";
    case JOB_PROGRESS_STAGES.downloading:
      return "Downloading assets";
    case JOB_PROGRESS_STAGES.aligning:
      return "Aligning captions";
    case JOB_PROGRESS_STAGES.composing:
      return "Composing video";
    case JOB_PROGRESS_STAGES.burning_subtitles:
      return "Burning subtitles";
    case JOB_PROGRESS_STAGES.muxing:
      return "Mixing audio";
    case JOB_PROGRESS_STAGES.uploading:
      return "Uploading";
    case JOB_PROGRESS_STAGES.finalizing:
      return "Finalizing";
    default:
      return stage.replace(/_/g, " ");
  }
}

export async function updateJobProgress(
  supabase: SupabaseClient,
  jobId: string,
  progress: GenerationJobProgress,
): Promise<void> {
  const label = progress.label ?? stageLabel(progress.stage);
  await supabase
    .from("generation_jobs")
    .update({
      progress: {
        stage: progress.stage,
        label,
        percent:
          progress.percent === undefined || progress.percent === null
            ? null
            : Math.min(100, Math.max(0, progress.percent)),
      },
    })
    .eq("id", jobId);
}

export async function clearJobProgress(supabase: SupabaseClient, jobId: string): Promise<void> {
  await supabase.from("generation_jobs").update({ progress: null }).eq("id", jobId);
}
