import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeWizardMetadata } from "@/lib/wizard/metadata";

/**
 * Synchronously completes a queued generation job with mock outputs (no external AI).
 */
export async function processMockGenerationJob(
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
          : `Welcome to your listing. This is placeholder copy generated in mock mode. ` +
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
      output = { ...output, clipUrls: [], note: "Mock scene clips — no video bytes." };
      break;
    }
    case "compose": {
      output = { ...output, finalUrl: null, note: "Mock compose — no render file." };
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
        }),
      })
      .eq("id", job.project_id);
  }

  return { ok: true };
}
