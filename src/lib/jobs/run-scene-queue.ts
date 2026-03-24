import type { SupabaseClient } from "@supabase/supabase-js";
import { processGenerationJob } from "@/lib/jobs/process-generation-job";

export type ProcessNextSceneResult =
  | {
      ok: true;
      remaining: number;
      processedJobId: string | null;
    }
  | {
      ok: false;
      error: string;
      remaining: number;
      processedJobId: string | null;
    };

/**
 * Picks the oldest queued `scene_video` job for the project and runs it.
 */
export async function processNextSceneVideoJob(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProcessNextSceneResult> {
  const { data: next, error: qErr } = await supabase
    .from("generation_jobs")
    .select("id")
    .eq("project_id", projectId)
    .eq("kind", "scene_video")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (qErr) {
    return {
      ok: false,
      error: qErr.message,
      remaining: 0,
      processedJobId: null,
    };
  }

  if (!next) {
    return {
      ok: true,
      remaining: 0,
      processedJobId: null,
    };
  }

  const result = await processGenerationJob(supabase, next.id);

  const { count: remaining } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("kind", "scene_video")
    .eq("status", "queued");

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      remaining: remaining ?? 0,
      processedJobId: next.id,
    };
  }

  return {
    ok: true,
    remaining: remaining ?? 0,
    processedJobId: next.id,
  };
}
