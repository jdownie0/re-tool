import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processNextSceneVideoJob } from "@/lib/jobs/run-scene-queue";

export const maxDuration = 300;

/**
 * POST { project_id: string } — process one queued `scene_video` job for the project (authenticated).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const project_id =
    body && typeof body === "object" && "project_id" in body
      ? (body as { project_id?: unknown }).project_id
      : undefined;

  if (typeof project_id !== "string" || !project_id) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
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

  const result = await processNextSceneVideoJob(supabase, project_id);
  return NextResponse.json(result);
}
