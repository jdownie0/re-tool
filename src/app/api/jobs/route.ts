import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processGenerationJob } from "@/lib/jobs/process-generation-job";
import { shouldProcessSceneVideoWithFal } from "@/lib/jobs/scene-video-fal";

const jobKinds = new Set([
  "script",
  "voice",
  "music",
  "scene_video",
  "compose",
]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected object body" }, { status: 400 });
  }

  const { project_id, kind, idempotency_key, input } = body as {
    project_id?: string;
    kind?: string;
    idempotency_key?: string | null;
    input?: Record<string, unknown>;
  };

  if (!project_id || typeof project_id !== "string") {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }
  if (!kind || !jobKinds.has(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${[...jobKinds].join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", project_id)
    .eq("user_id", user.id)
    .single();

  if (projErr || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: job, error: insErr } = await supabase
    .from("generation_jobs")
    .insert({
      project_id,
      kind,
      status: "queued",
      idempotency_key: idempotency_key ?? null,
      input: input && typeof input === "object" ? input : {},
    })
    .select("id, status, kind, created_at")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json(
        { error: "Duplicate idempotency key for this project" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const deferScene =
    kind === "scene_video" && shouldProcessSceneVideoWithFal();

  if (!deferScene) {
    const processed = await processGenerationJob(supabase, job.id);
    if (!processed.ok) {
      return NextResponse.json({ error: processed.error, job }, { status: 500 });
    }
  }

  const { data: finalJob } = await supabase
    .from("generation_jobs")
    .select("id, status, kind, output, created_at")
    .eq("id", job.id)
    .single();

  return NextResponse.json({ job: finalJob ?? job });
}
