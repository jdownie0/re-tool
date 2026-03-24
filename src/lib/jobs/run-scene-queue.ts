import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processGenerationJob } from "@/lib/jobs/process-generation-job";

/** Parallel Fal runs per wave (default 3, max 8). Set SCENE_VIDEO_CONCURRENCY=1 for serial. */
export function getSceneVideoConcurrency(): number {
  const raw = process.env.SCENE_VIDEO_CONCURRENCY?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 3;
  if (!Number.isFinite(n) || n < 1) {
    return 3;
  }
  return Math.min(8, Math.floor(n));
}

/**
 * Drains queued `scene_video` jobs in parallel waves until `deadlineMs` or the queue is empty.
 * Wall time is roughly one clip duration per wave when clips are similar length (not N× serial).
 */
export async function processSceneVideoJobsUntilDeadline(
  supabase: SupabaseClient,
  options: {
    deadlineMs: number;
    /** When set, only this project's jobs are considered. */
    projectId?: string;
    revalidateWizardPath?: string;
  },
): Promise<void> {
  const concurrency = getSceneVideoConcurrency();
  const deadline = Date.now() + options.deadlineMs;

  while (Date.now() < deadline) {
    let q = supabase
      .from("generation_jobs")
      .select("id")
      .eq("kind", "scene_video")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(concurrency);

    if (options.projectId) {
      q = q.eq("project_id", options.projectId);
    }

    const { data: rows, error } = await q;

    if (error) {
      console.error("processSceneVideoJobsUntilDeadline", error.message);
      break;
    }
    if (!rows?.length) {
      break;
    }

    await Promise.allSettled(
      rows.map((row) => processGenerationJob(supabase, row.id)),
    );

    if (options.revalidateWizardPath) {
      revalidatePath(options.revalidateWizardPath);
    }
  }
}

/**
 * Drains queued `compose` jobs (one at a time) until `deadlineMs` or the queue is empty.
 */
export async function processComposeJobsUntilDeadline(
  supabase: SupabaseClient,
  options: {
    deadlineMs: number;
    projectId?: string;
    revalidateWizardPath?: string;
  },
): Promise<void> {
  const deadline = Date.now() + options.deadlineMs;

  while (Date.now() < deadline) {
    let q = supabase
      .from("generation_jobs")
      .select("id")
      .eq("kind", "compose")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);

    if (options.projectId) {
      q = q.eq("project_id", options.projectId);
    }

    const { data: rows, error } = await q;

    if (error) {
      console.error("processComposeJobsUntilDeadline", error.message);
      break;
    }
    if (!rows?.length) {
      break;
    }

    const row = rows[0]!;
    await processGenerationJob(supabase, row.id);

    if (options.revalidateWizardPath) {
      revalidatePath(options.revalidateWizardPath);
    }
  }
}

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
