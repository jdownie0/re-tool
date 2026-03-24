"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { processGenerationJob } from "@/lib/jobs/process-generation-job";
import { shouldDeferCompose } from "@/lib/jobs/compose-video";
import {
  processComposeJobsUntilDeadline,
  processNextSceneVideoJob,
  processSceneVideoJobsUntilDeadline,
} from "@/lib/jobs/run-scene-queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { shouldProcessSceneVideoWithFal } from "@/lib/jobs/scene-video-fal";
import { getWizardFromMetadata, mergeWizardMetadata } from "@/lib/wizard/metadata";
import { buildListingContextForScript } from "@/lib/ai/listing-script-context";
import type { ListingSnapshotRow } from "@/lib/ai/listing-script-context";
import {
  ELEVENLABS_MAX_TTS_SCRIPT_CHARS,
  synthesizeVoiceMp3,
} from "@/lib/ai/elevenlabs-tts";
import {
  buildMusicPromptForElevenLabs,
  clampMusicLengthMs,
  composeMusicMp3,
} from "@/lib/ai/elevenlabs-music";
import { getElevenLabsApiKey } from "@/lib/ai/elevenlabs-env";
import { generateVoiceoverScriptFromListing } from "@/lib/ai/openai-listing-script";
import {
  DEFAULT_WIZARD_DURATION_SECONDS,
  SECONDS_PER_SCENE,
  VOICE_PRESETS,
} from "@/lib/wizard/constants";
import {
  listingSnapshotRowToDisplay,
  type ListingDetailsDisplay,
} from "@/lib/wizard/listing-details";
import type { WizardMetadata } from "@/lib/wizard/types";

const LEGACY_VOICE_IDS = new Set<string>(VOICE_PRESETS.map((p) => p.id));

async function assertProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, metadata, listing_url, duration_seconds")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (error || !project) {
    throw new Error("Project not found");
  }
  return { supabase, user, project };
}

export async function updateWizardMetadata(
  projectId: string,
  patch: Partial<WizardMetadata>,
) {
  const { supabase, project } = await assertProject(projectId);
  const next = mergeWizardMetadata(
    project.metadata as Record<string, unknown> | null,
    patch,
  );
  await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

/**
 * Generates voiceover script text from `listing_snapshots` (Apify/Zillow data) via OpenAI.
 * Requires `OPEN_AI_SECRET` (or `OPENAI_API_KEY`). Updates `wizard.scriptDraft` and marks script ready for the mock voice pipeline.
 */
export async function generateListingScriptWithOpenAI(projectId: string) {
  const { supabase, user } = await assertProject(projectId);

  const { data: projectRow } = await supabase
    .from("projects")
    .select("title, duration_seconds, metadata")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (!projectRow) {
    throw new Error("Project not found");
  }

  const { data: snap } = await supabase
    .from("listing_snapshots")
    .select(
      "address, price, beds, baths, sqft, year_built, neighborhood_summary, features, raw",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (!snap) {
    throw new Error(
      "No listing data found. On the Photos step, add a listing URL and fetch listing details first.",
    );
  }

  const context = buildListingContextForScript(
    snap as unknown as ListingSnapshotRow,
  );
  if (!context) {
    throw new Error(
      "Listing snapshot has no usable description or facts. Fetch listing details again on the Photos step.",
    );
  }

  const duration =
    projectRow.duration_seconds ?? DEFAULT_WIZARD_DURATION_SECONDS;

  const script = await generateVoiceoverScriptFromListing(context, {
    durationSeconds: duration,
    projectTitle: projectRow.title ?? null,
  });

  const next = mergeWizardMetadata(
    projectRow.metadata as Record<string, unknown> | null,
    {
      scriptDraft: script,
      scriptMockReady: true,
    },
  );

  await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

/**
 * Synthesizes the script with Eleven Labs, stores MP3 in `generated-audio`, and saves a `voice_sample` asset.
 */
export async function generateVoiceoverWithElevenLabs(projectId: string) {
  const { supabase, user, project } = await assertProject(projectId);
  const wizard = getWizardFromMetadata(project.metadata);

  const script = wizard.scriptDraft?.trim();
  if (!script) {
    throw new Error("Add a script before generating voiceover.");
  }

  const voiceId = wizard.voicePreset;
  if (LEGACY_VOICE_IDS.has(voiceId)) {
    throw new Error("Select an Eleven Labs voice from the list above.");
  }

  if (!getElevenLabsApiKey()) {
    throw new Error("Eleven Labs is not configured. Set ELEVEN_LABS_KEY_ID.");
  }

  if (script.length > ELEVENLABS_MAX_TTS_SCRIPT_CHARS) {
    throw new Error(
      `Script is too long for one speech request (max ${ELEVENLABS_MAX_TTS_SCRIPT_CHARS.toLocaleString()} characters). Shorten the script and try again.`,
    );
  }

  const tts = await synthesizeVoiceMp3(voiceId, script);
  if (!tts.ok) {
    throw new Error(tts.error);
  }

  const { data: oldAssets } = await supabase
    .from("project_assets")
    .select("id, storage_path")
    .eq("project_id", projectId)
    .eq("type", "voice_sample");

  for (const asset of oldAssets ?? []) {
    await supabase.storage.from("generated-audio").remove([asset.storage_path]);
    await supabase.from("project_assets").delete().eq("id", asset.id);
  }

  const storagePath = `${user.id}/${projectId}/voiceover.mp3`;
  const { error: upErr } = await supabase.storage
    .from("generated-audio")
    .upload(storagePath, new Uint8Array(tts.buffer), {
      contentType: "audio/mpeg",
      upsert: true,
    });
  if (upErr) {
    throw new Error(upErr.message);
  }

  const words = script.split(/\s+/).filter(Boolean).length;
  const estimatedMs = Math.round(words * 450);

  const { error: insErr } = await supabase.from("project_assets").insert({
    project_id: projectId,
    type: "voice_sample",
    storage_path: storagePath,
    mime_type: "audio/mpeg",
    sort_order: 0,
    duration_ms: estimatedMs,
  });
  if (insErr) {
    throw new Error(insErr.message);
  }

  const next = mergeWizardMetadata(
    project.metadata as Record<string, unknown> | null,
    {
      voiceMockReady: true,
      voiceDurationMs: estimatedMs,
    },
  );
  await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

/**
 * Composes instrumental background music with Eleven Labs, stores MP3 in `generated-audio`,
 * and saves a `music` asset. Length follows project `duration_seconds` (clamped to API limits).
 */
export async function generateMusicWithElevenLabs(projectId: string) {
  const { supabase, user, project } = await assertProject(projectId);
  const wizard = getWizardFromMetadata(project.metadata);

  const preset = wizard.musicPreset;
  const userPrompt = wizard.musicPrompt?.trim() ?? "";
  if (!preset && !userPrompt) {
    throw new Error("Pick a mood or describe a style.");
  }

  if (!getElevenLabsApiKey()) {
    throw new Error("Eleven Labs is not configured. Set ELEVEN_LABS_KEY_ID.");
  }

  const prompt = buildMusicPromptForElevenLabs(preset, userPrompt);
  const durationSec =
    project.duration_seconds ?? DEFAULT_WIZARD_DURATION_SECONDS;
  const musicLengthMs = clampMusicLengthMs(durationSec * 1000);

  const composed = await composeMusicMp3(prompt, musicLengthMs);
  if (!composed.ok) {
    throw new Error(composed.error);
  }

  const { data: oldMusic } = await supabase
    .from("project_assets")
    .select("id, storage_path")
    .eq("project_id", projectId)
    .eq("type", "music");

  for (const asset of oldMusic ?? []) {
    await supabase.storage.from("generated-audio").remove([asset.storage_path]);
    await supabase.from("project_assets").delete().eq("id", asset.id);
  }

  const storagePath = `${user.id}/${projectId}/background-music.mp3`;
  const { error: upErr } = await supabase.storage
    .from("generated-audio")
    .upload(storagePath, new Uint8Array(composed.buffer), {
      contentType: "audio/mpeg",
      upsert: true,
    });
  if (upErr) {
    throw new Error(upErr.message);
  }

  const { error: insErr } = await supabase.from("project_assets").insert({
    project_id: projectId,
    type: "music",
    storage_path: storagePath,
    mime_type: "audio/mpeg",
    sort_order: 0,
    duration_ms: musicLengthMs,
  });
  if (insErr) {
    throw new Error(insErr.message);
  }

  const next = mergeWizardMetadata(
    project.metadata as Record<string, unknown> | null,
    {
      musicPreset: preset,
      musicPrompt: userPrompt,
      musicSkipped: false,
      musicMockReady: true,
      musicDurationMs: musicLengthMs,
    },
  );
  await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function setDurationAndPhotos(
  projectId: string,
  durationSeconds: number,
) {
  const { supabase } = await assertProject(projectId);
  await supabase
    .from("projects")
    .update({ duration_seconds: durationSeconds })
    .eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function setListingUrl(projectId: string, listingUrl: string) {
  const { supabase } = await assertProject(projectId);
  await supabase
    .from("projects")
    .update({ listing_url: listingUrl.trim() || null })
    .eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function updateProjectTitle(projectId: string, title: string) {
  const { supabase } = await assertProject(projectId);
  const t = title.trim();
  await supabase
    .from("projects")
    .update({ title: t.length > 0 ? t : "Untitled listing" })
    .eq("id", projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath("/app/projects");
}

/**
 * Writes `listing_snapshots` for a project from `url` (Apify when configured, else stub).
 * @throws When Apify fails and stub fallback is disabled.
 */
async function persistListingSnapshotForUrl(
  supabase: SupabaseClient,
  projectId: string,
  url: string,
) {
  await supabase.from("listing_snapshots").delete().eq("project_id", projectId);

  const token = process.env.APIFY_API_TOKEN?.trim();
  const fallbackStub =
    process.env.LISTING_INGEST_FALLBACK_STUB === "1" ||
    process.env.LISTING_INGEST_FALLBACK_STUB === "true";

  if (url && token) {
    try {
      const { runListingScrape } = await import("@/lib/ingest/apify-zillow");
      const snap = await runListingScrape(url);
      await supabase.from("listing_snapshots").insert({
        project_id: projectId,
        source_url: snap.source_url,
        provider: snap.provider,
        address: snap.address,
        price: snap.price,
        beds: snap.beds,
        baths: snap.baths,
        sqft: snap.sqft,
        year_built: snap.year_built,
        neighborhood_summary:
          snap.neighborhood_summary ??
          "Neighborhood details were not returned for this listing.",
        comps: snap.comps,
        features: snap.features.length ? snap.features : [],
        raw: snap.raw,
      });
      return;
    } catch (e) {
      if (!fallbackStub) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      const ingestError = e instanceof Error ? e.message : String(e);
      await supabase.from("listing_snapshots").insert({
        project_id: projectId,
        source_url: url || null,
        provider: "manual_url_stub",
        address: url ? "Listing address (stub — ingest failed)" : null,
        neighborhood_summary:
          "Neighborhood highlights will appear here once a listing data source is connected.",
        comps: [],
        features: [
          "Marketable features will be extracted from your listing source.",
          "Year built, finishes, and outdoor space — stub data for now.",
        ],
        raw: {
          stub: true,
          listing_url: url || null,
          ingest_error: ingestError,
        },
      });
      return;
    }
  }

  await supabase.from("listing_snapshots").insert({
    project_id: projectId,
    source_url: url || null,
    provider: url ? "manual_url_stub" : "none",
    address: url ? "Listing address (stub — add APIFY_API_TOKEN to ingest live data)" : null,
    neighborhood_summary:
      "Neighborhood highlights will appear here once a listing data source is connected.",
    comps: [],
    features: [
      "Marketable features will be extracted from your listing source.",
      "Year built, finishes, and outdoor space — stub data for now.",
    ],
    raw: { stub: true, listing_url: url || null },
  });
}

/**
 * Saves the current `projects.listing_url` to `listing_snapshots` (Apify or stub). Used when continuing the wizard.
 */
export async function saveStubListingSnapshot(projectId: string) {
  const { supabase, project } = await assertProject(projectId);
  const url = project.listing_url?.trim() ?? "";
  await persistListingSnapshotForUrl(supabase, projectId, url);
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

/**
 * Saves listing URL on the project, runs ingest, returns details for display (or an error).
 */
export async function fetchListingDetails(
  projectId: string,
  listingUrl: string,
): Promise<
  { ok: true; details: ListingDetailsDisplay } | { ok: false; error: string }
> {
  const trimmed = listingUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a listing URL first." };
  }

  const { supabase } = await assertProject(projectId);

  await supabase
    .from("projects")
    .update({ listing_url: trimmed })
    .eq("id", projectId);

  try {
    await persistListingSnapshotForUrl(supabase, projectId, trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  const { data: row, error } = await supabase
    .from("listing_snapshots")
    .select(
      "provider, source_url, address, price, beds, baths, sqft, year_built, neighborhood_summary, features, raw",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !row) {
    return {
      ok: false,
      error: error?.message ?? "Listing snapshot was not saved.",
    };
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);

  return {
    ok: true,
    details: listingSnapshotRowToDisplay(row as unknown as Record<string, unknown>, null),
  };
}

export async function deleteProjectPhoto(projectId: string, assetId: string) {
  const { supabase } = await assertProject(projectId);

  const { data: asset, error: fetchErr } = await supabase
    .from("project_assets")
    .select("id, storage_path, type")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("type", "photo")
    .maybeSingle();

  if (fetchErr || !asset) {
    throw new Error("Photo not found");
  }

  const { error: rmErr } = await supabase.storage
    .from("listing-photos")
    .remove([asset.storage_path]);

  if (rmErr) {
    throw new Error(rmErr.message);
  }

  const { error: delErr } = await supabase
    .from("project_assets")
    .delete()
    .eq("id", assetId)
    .eq("project_id", projectId);

  if (delErr) {
    throw new Error(delErr.message);
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function reorderProjectPhotos(projectId: string, orderedAssetIds: string[]) {
  const { supabase } = await assertProject(projectId);
  for (let i = 0; i < orderedAssetIds.length; i++) {
    await supabase
      .from("project_assets")
      .update({ sort_order: i })
      .eq("id", orderedAssetIds[i]!)
      .eq("project_id", projectId);
  }
  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function enqueueGenerationJob(
  projectId: string,
  kind: "script" | "voice" | "music" | "scene_video" | "compose",
  input: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const { supabase } = await assertProject(projectId);

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      project_id: projectId,
      kind,
      status: "queued",
      idempotency_key: idempotencyKey ?? null,
      input,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505" && idempotencyKey) {
      const { data: existing } = await supabase
        .from("generation_jobs")
        .select("id")
        .eq("project_id", projectId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (existing?.id) {
        const deferScene =
          kind === "scene_video" && shouldProcessSceneVideoWithFal();
        const deferCompose = kind === "compose" && shouldDeferCompose();
        if (!deferScene && !deferCompose) {
          const result = await processGenerationJob(supabase, existing.id);
          if (!result.ok) {
            throw new Error(result.error);
          }
        }
        if (deferCompose) {
          await scheduleComposeProcessing(projectId);
        }
        revalidatePath(`/app/projects/${projectId}/wizard`);
        return { ok: true as const, jobId: existing.id };
      }
    }
    throw new Error(error.message);
  }

  if (!job) {
    throw new Error("Job not created");
  }

  const deferScene =
    kind === "scene_video" && shouldProcessSceneVideoWithFal();
  const deferCompose = kind === "compose" && shouldDeferCompose();

  if (!deferScene && !deferCompose) {
    const result = await processGenerationJob(supabase, job.id);
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  if (deferCompose) {
    await scheduleComposeProcessing(projectId);
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);
  return { ok: true as const, jobId: job.id };
}

export async function enqueueSceneVideoJobs(projectId: string) {
  const { supabase } = await assertProject(projectId);

  const { data: photos, error: photoErr } = await supabase
    .from("project_assets")
    .select("id, storage_path, sort_order")
    .eq("project_id", projectId)
    .eq("type", "photo")
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (photoErr) {
    throw new Error(photoErr.message);
  }

  const list = photos ?? [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const idempotencyKey = `scene-video-${p.id}`;
    const sceneIndex = p.sort_order ?? i;
    const { error } = await supabase.from("generation_jobs").insert({
      project_id: projectId,
      kind: "scene_video",
      status: "queued",
      idempotency_key: idempotencyKey,
      input: {
        photo_asset_id: p.id,
        storage_path: p.storage_path,
        scene_index: sceneIndex,
        prompt:
          "Very subtle parallax or slow push-in only; no dramatic moves.",
        duration_sec: SECONDS_PER_SCENE,
      },
    });
    if (error?.code === "23505") {
      continue;
    }
    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);
}

/** ~4.5m fits under typical 300s serverless max when each clip ~60–90s Fal time. */
const SCENE_VIDEO_AFTER_BUDGET_MS = 270_000;

/** Same budget class as scene Fal drain; FFmpeg compose + upload can be heavy. */
const COMPOSE_AFTER_BUDGET_MS = 270_000;

/**
 * Drains queued `scene_video` jobs for this project **after** the HTTP response returns,
 * so the browser is not held open for minutes (avoids "fetch failed" / timeouts).
 * Prefer `SUPABASE_SERVICE_ROLE_KEY` (reliable in background); otherwise uses your session
 * (works when `after()` retains the request context).
 */
export async function scheduleSceneVideoProcessing(projectId: string): Promise<void> {
  await assertProject(projectId);

  after(async () => {
    try {
      const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
        ? createAdminClient()
        : await createClient();
      await processSceneVideoJobsUntilDeadline(supabase, {
        deadlineMs: SCENE_VIDEO_AFTER_BUDGET_MS,
        projectId,
        revalidateWizardPath: `/app/projects/${projectId}/wizard`,
      });
    } catch (e) {
      console.error("scheduleSceneVideoProcessing after()", e);
    }
  });
}

/**
 * Drains queued `compose` jobs after the response returns (`ENABLE_COMPOSE` / FFmpeg path).
 */
export async function scheduleComposeProcessing(projectId: string): Promise<void> {
  await assertProject(projectId);

  after(async () => {
    try {
      const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
        ? createAdminClient()
        : await createClient();
      await processComposeJobsUntilDeadline(supabase, {
        deadlineMs: COMPOSE_AFTER_BUDGET_MS,
        projectId,
        revalidateWizardPath: `/app/projects/${projectId}/wizard`,
      });
    } catch (e) {
      console.error("scheduleComposeProcessing after()", e);
    }
  });
}

/**
 * Enqueues a single final-render `compose` job (idempotent per project) and kicks background processing when deferred.
 */
export async function enqueueFinalRender(projectId: string) {
  const { supabase } = await assertProject(projectId);

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      project_id: projectId,
      kind: "compose",
      status: "queued",
      idempotency_key: `compose-${projectId}`,
      input: {},
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("generation_jobs")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("idempotency_key", `compose-${projectId}`)
        .single();
      if (existing?.id) {
        const deferCompose = shouldDeferCompose();

        if (existing.status === "running") {
          if (deferCompose) {
            await scheduleComposeProcessing(projectId);
          }
          revalidatePath(`/app/projects/${projectId}/wizard`);
          return { ok: true as const, jobId: existing.id };
        }

        if (existing.status === "succeeded" || existing.status === "failed") {
          await supabase
            .from("generation_jobs")
            .update({
              status: "queued",
              error: null,
              progress: null,
              output: null,
            })
            .eq("id", existing.id);
        }

        if (!deferCompose) {
          const result = await processGenerationJob(supabase, existing.id);
          if (!result.ok) {
            throw new Error(result.error);
          }
        } else {
          await scheduleComposeProcessing(projectId);
        }
        revalidatePath(`/app/projects/${projectId}/wizard`);
        return { ok: true as const, jobId: existing.id };
      }
    }
    throw new Error(error.message);
  }

  if (!job) {
    throw new Error("Job not created");
  }

  const deferCompose = shouldDeferCompose();
  if (!deferCompose) {
    const result = await processGenerationJob(supabase, job.id);
    if (!result.ok) {
      throw new Error(result.error);
    }
  } else {
    await scheduleComposeProcessing(projectId);
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);
  return { ok: true as const, jobId: job.id };
}

export async function processOneQueuedSceneVideoJob(projectId: string) {
  const { supabase } = await assertProject(projectId);
  const result = await processNextSceneVideoJob(supabase, projectId);
  revalidatePath(`/app/projects/${projectId}/wizard`);
  return result;
}

export async function resetFailedSceneVideoJobs(projectId: string) {
  const { supabase } = await assertProject(projectId);

  const { data: failed, error: fetchErr } = await supabase
    .from("generation_jobs")
    .select("id, output")
    .eq("project_id", projectId)
    .eq("kind", "scene_video")
    .eq("status", "failed");

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }

  for (const row of failed ?? []) {
    const out = row.output as Record<string, unknown> | null;
    const hasFalUrl =
      typeof out?.fal_video_url === "string" && out.fal_video_url.trim().length > 0;

    await supabase
      .from("generation_jobs")
      .update({
        status: "queued",
        error: null,
        ...(hasFalUrl ? {} : { output: null }),
      })
      .eq("id", row.id);
  }

  revalidatePath(`/app/projects/${projectId}/wizard`);
}

export async function setMusicSkipped(projectId: string, skipped: boolean) {
  await updateWizardMetadata(projectId, {
    musicSkipped: skipped,
    ...(skipped ? { musicMockReady: false } : {}),
  });
}

export async function setCaptionsEnabled(projectId: string, enabled: boolean) {
  await updateWizardMetadata(projectId, { captionsEnabled: enabled });
}
