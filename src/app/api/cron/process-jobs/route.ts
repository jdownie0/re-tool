import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  processComposeJobsUntilDeadline,
  processSceneVideoJobsUntilDeadline,
} from "@/lib/jobs/run-scene-queue";

export const maxDuration = 300;

/** Leave headroom under `maxDuration` (each wave is ~max clip length when parallel). */
const CRON_TIME_BUDGET_MS = 270_000;

/**
 * Drains queued `scene_video` jobs (parallel waves, see SCENE_VIDEO_CONCURRENCY), then `compose`
 * jobs, splitting the time budget so both can run under `maxDuration`. Secure with `CRON_SECRET`.
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

  const admin = createAdminClient();
  const started = Date.now();

  const halfBudget = Math.floor(CRON_TIME_BUDGET_MS / 2);

  await processSceneVideoJobsUntilDeadline(admin, {
    deadlineMs: halfBudget,
  });

  await processComposeJobsUntilDeadline(admin, {
    deadlineMs: halfBudget,
  });

  const elapsedMs = Date.now() - started;
  return NextResponse.json({ ok: true, elapsedMs });
}
