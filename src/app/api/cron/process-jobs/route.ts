import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processGenerationJob } from "@/lib/jobs/process-generation-job";

export const maxDuration = 300;

/**
 * Processes a batch of queued `scene_video` jobs (service role). Secure with `CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 501 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    10,
    Math.max(1, Number(process.env.CRON_SCENE_JOBS_BATCH ?? "3") || 3),
  );

  const admin = createAdminClient();

  const { data: jobs, error } = await admin
    .from("generation_jobs")
    .select("id")
    .eq("kind", "scene_video")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const processed: { id: string; ok: boolean; error?: string }[] = [];

  for (const row of jobs ?? []) {
    const r = await processGenerationJob(admin, row.id);
    processed.push({
      id: row.id,
      ok: r.ok,
      error: r.ok ? undefined : r.error,
    });
  }

  return NextResponse.json({ processed: processed.length, jobs: processed });
}
