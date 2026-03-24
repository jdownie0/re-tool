import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alignAudioToText } from "@/lib/ai/elevenlabs-forced-alignment";
import { isElevenLabsConfigured } from "@/lib/ai/elevenlabs-env";
import {
  JOB_PROGRESS_STAGES,
  updateJobProgress,
} from "@/lib/jobs/job-progress";
import { getWizardFromMetadata } from "@/lib/wizard/metadata";
import { formatStorageClientError } from "@/lib/supabase/supabase-fetch";
import { uploadToRendersWithRetry } from "@/lib/supabase/render-storage-upload";
import {
  formatBytesHuman,
  getMaxRenderUploadBytes,
  renderUploadErrorHint,
} from "@/lib/supabase/storage-limits";
import { finalRenderStorageObjectPath } from "@/lib/storage/final-render-key";
import { wordsToAss } from "@/lib/video/words-to-ass";

/** True when `ffmpeg -version` succeeds (PATH or `FFMPEG_PATH`). */
export function ffmpegAvailable(): boolean {
  const ffmpeg = getFfmpegExecutable();
  const r = spawnSync(ffmpeg, ["-version"], {
    encoding: "utf8",
    env: process.env,
  });
  return r.status === 0;
}

/**
 * Real FFmpeg compose when: `ENABLE_COMPOSE=1`, or unset/`auto` and ffmpeg is on PATH.
 * Set `ENABLE_COMPOSE=0` to force mock (first-clip-only) export.
 */
export function shouldProcessComposeWithFfmpeg(): boolean {
  const v = process.env.ENABLE_COMPOSE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") {
    return false;
  }
  if (v === "1" || v === "true" || v === "yes") {
    return true;
  }
  return ffmpegAvailable();
}

/** Defer compose to `after()` + background drain (same idea as Fal scene clips). */
export function shouldDeferCompose(): boolean {
  return shouldProcessComposeWithFfmpeg();
}

export function getFfmpegExecutable(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

const COMPOSE_WEIGHTS = {
  downloadEnd: 15,
  concatEnd: 55,
  muxEnd: 80,
  uploadStart: 85,
} as const;

function runFfmpeg(
  ffmpeg: string,
  args: string[],
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
      } else {
        reject(
          new Error(
            `ffmpeg exited with code ${code}: ${stderr.slice(-800) || "(no stderr)"}`,
          ),
        );
      }
    });
  });
}

/** Large scene MP4s can take a while over HTTPS from Supabase. */
const DOWNLOAD_TIMEOUT_MS = 600_000;

async function downloadToFile(
  url: string,
  destPath: string,
  context: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const extra =
      e instanceof Error && e.name === "TimeoutError"
        ? ` Timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s.`
        : "";
    throw new Error(
      `${context}: download failed (${msg}).${extra} ` +
        "The server must reach your Supabase storage host (check VPN, firewall, and NEXT_PUBLIC_SUPABASE_URL).",
    );
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `${context}: HTTP ${res.status} ${errText.slice(0, 400)}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

/**
 * Concatenates scene MP4s, mixes voice (+ optional music), uploads `final_render` to `renders` (`final-{timestamp}.mp4`).
 */
export async function processComposeVideo(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ffmpeg = getFfmpegExecutable();

  const { data: job, error: fetchErr } = await supabase
    .from("generation_jobs")
    .select("id, project_id, kind, status, input")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job || job.kind !== "compose") {
    return { ok: false, error: fetchErr?.message ?? "Job not found" };
  }
  if (job.status !== "queued" && job.status !== "running") {
    return { ok: true };
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("user_id, metadata")
    .eq("id", job.project_id)
    .single();

  if (projErr || !project) {
    return { ok: false, error: "Project not found" };
  }

  const userId = project.user_id;
  const wizard = getWizardFromMetadata(
    project.metadata as Record<string, unknown> | null,
  );

  await supabase
    .from("generation_jobs")
    .update({
      status: "running",
      provider: "ffmpeg",
      error: null,
      progress: {
        stage: JOB_PROGRESS_STAGES.downloading,
        label: "Downloading assets",
        percent: 5,
      },
    })
    .eq("id", jobId);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "compose-"));
  const clipPaths: string[] = [];

  try {
    const { data: clips, error: clipErr } = await supabase
      .from("project_assets")
      .select("id, storage_path, sort_order")
      .eq("project_id", job.project_id)
      .eq("type", "video_clip")
      .order("sort_order", { ascending: true, nullsFirst: false });

    if (clipErr) {
      throw new Error(clipErr.message);
    }
    const list = clips ?? [];
    if (list.length === 0) {
      throw new Error("No video clips to compose. Generate scene clips first.");
    }

    let i = 0;
    for (const c of list) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("generated-video")
        .createSignedUrl(c.storage_path, 3600);
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? "Could not sign clip URL.");
      }
      const p = path.join(tmpRoot, `clip-${i++}.mp4`);
      await downloadToFile(
        signed.signedUrl,
        p,
        `Scene clip ${i}/${list.length}`,
      );
      clipPaths.push(p);
      const pct =
        5 +
        Math.round(
          (COMPOSE_WEIGHTS.downloadEnd - 5) * (i / Math.max(1, list.length)),
        );
      await updateJobProgress(supabase, jobId, {
        stage: JOB_PROGRESS_STAGES.downloading,
        percent: pct,
      });
    }

    await updateJobProgress(supabase, jobId, {
      stage: JOB_PROGRESS_STAGES.composing,
      percent: COMPOSE_WEIGHTS.downloadEnd,
    });

    const listFile = path.join(tmpRoot, "concat.txt");
    const listBody = clipPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await fs.writeFile(listFile, listBody, "utf8");

    const concatOut = path.join(tmpRoot, "concat.mp4");
    try {
      await runFfmpeg(ffmpeg, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        concatOut,
      ]);
    } catch {
      await runFfmpeg(ffmpeg, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        concatOut,
      ]);
    }

    await updateJobProgress(supabase, jobId, {
      stage: JOB_PROGRESS_STAGES.muxing,
      percent: COMPOSE_WEIGHTS.concatEnd,
    });

    const { data: voiceAsset } = await supabase
      .from("project_assets")
      .select("storage_path")
      .eq("project_id", job.project_id)
      .eq("type", "voice_sample")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: musicAsset } = await supabase
      .from("project_assets")
      .select("storage_path")
      .eq("project_id", job.project_id)
      .eq("type", "music")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let voicePath: string | null = null;
    let musicPath: string | null = null;

    if (voiceAsset?.storage_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("generated-audio")
        .createSignedUrl(voiceAsset.storage_path, 3600);
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? "Could not sign voice URL.");
      }
      voicePath = path.join(tmpRoot, "voice.mp3");
      await downloadToFile(signed.signedUrl, voicePath, "Voiceover");
    }

    if (musicAsset?.storage_path && !wizard.musicSkipped) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("generated-audio")
        .createSignedUrl(musicAsset.storage_path, 3600);
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? "Could not sign music URL.");
      }
      musicPath = path.join(tmpRoot, "music.mp3");
      await downloadToFile(signed.signedUrl, musicPath, "Background music");
    }

    const finalTmp = path.join(tmpRoot, "final.mp4");

    if (voicePath && musicPath) {
      await runFfmpeg(ffmpeg, [
        "-y",
        "-i",
        concatOut,
        "-i",
        voicePath,
        "-i",
        musicPath,
        "-filter_complex",
        "[1:a]volume=1.0[v];[2:a]volume=0.35[m];[v][m]amix=inputs=2:duration=longest[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        finalTmp,
      ]);
    } else if (voicePath) {
      await runFfmpeg(ffmpeg, [
        "-y",
        "-i",
        concatOut,
        "-i",
        voicePath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        finalTmp,
      ]);
    } else if (musicPath) {
      await runFfmpeg(ffmpeg, [
        "-y",
        "-i",
        concatOut,
        "-i",
        musicPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        finalTmp,
      ]);
    } else {
      await fs.copyFile(concatOut, finalTmp);
    }

    let fileToUpload = finalTmp;
    let captionsApplied = false;

    if (wizard.captionsEnabled) {
      if (!voicePath) {
        throw new Error(
          "Captions require a voiceover MP3. Generate voiceover before exporting with captions.",
        );
      }
      if (!isElevenLabsConfigured()) {
        throw new Error(
          "Captions require Eleven Labs forced alignment. Set ELEVEN_LABS_KEY_ID.",
        );
      }
      const script = wizard.scriptDraft.trim();
      if (!script) {
        throw new Error("Captions are on but the script is empty.");
      }
      await updateJobProgress(supabase, jobId, {
        stage: JOB_PROGRESS_STAGES.aligning,
        percent: 58,
      });
      const voiceBuf = await fs.readFile(voicePath);
      const aligned = await alignAudioToText(voiceBuf, script);
      if (!aligned.ok) {
        throw new Error(aligned.error);
      }
      const assPath = path.join(tmpRoot, "captions.ass");
      await fs.writeFile(assPath, wordsToAss(aligned.words), "utf8");

      await updateJobProgress(supabase, jobId, {
        stage: JOB_PROGRESS_STAGES.burning_subtitles,
        percent: 72,
      });
      const burnedPath = path.join(tmpRoot, "burned.mp4");
      const assForFilter = assPath.replace(/\\/g, "/");
      await runFfmpeg(ffmpeg, [
        "-y",
        "-i",
        fileToUpload,
        "-vf",
        `ass=${assForFilter}`,
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        burnedPath,
      ]);
      fileToUpload = burnedPath;
      captionsApplied = true;
    }

    await updateJobProgress(supabase, jobId, {
      stage: JOB_PROGRESS_STAGES.uploading,
      percent: COMPOSE_WEIGHTS.uploadStart,
    });

    const outPath = finalRenderStorageObjectPath(userId, job.project_id);

    const maxUploadBytes = getMaxRenderUploadBytes();
    const fileStat = await fs.stat(fileToUpload);
    if (fileStat.size > maxUploadBytes) {
      throw new Error(
        `Final video is ${formatBytesHuman(fileStat.size)}, over the configured max upload ` +
          `(${formatBytesHuman(maxUploadBytes)}). Raise the Storage file size limit in Supabase Dashboard ` +
          `(Project Settings → Storage), set RETOOL_MAX_RENDER_UPLOAD_BYTES to match that cap, then retry. ` +
          `Alternatively shorten the video or lower FFmpeg quality to shrink the file.`,
      );
    }

    const { error: upErr } = await uploadToRendersWithRetry(
      supabase,
      outPath,
      () => createReadStream(fileToUpload),
      {
        contentType: "video/mp4",
        upsert: true,
      },
    );

    if (upErr) {
      const detail = formatStorageClientError(upErr);
      const extra = renderUploadErrorHint(detail);
      throw new Error(
        `Upload to Supabase storage (bucket "renders") failed: ${detail}.` +
          (extra ||
            ` Check HTTPS to Supabase (NEXT_PUBLIC_SUPABASE_URL, VPN, proxy—not localhost when the worker runs remotely).`),
      );
    }

    const { data: previousFinals } = await supabase
      .from("project_assets")
      .select("id, storage_path")
      .eq("project_id", job.project_id)
      .eq("type", "final_render");

    for (const row of previousFinals ?? []) {
      if (row.storage_path) {
        await supabase.storage
          .from("renders")
          .remove([row.storage_path])
          .catch(() => {});
      }
      await supabase.from("project_assets").delete().eq("id", row.id);
    }

    const { data: assetRow, error: assetErr } = await supabase
      .from("project_assets")
      .insert({
        project_id: job.project_id,
        type: "final_render",
        storage_path: outPath,
        mime_type: "video/mp4",
      })
      .select("id")
      .single();

    if (assetErr || !assetRow) {
      throw new Error(assetErr?.message ?? "Failed to save final render asset.");
    }

    await updateJobProgress(supabase, jobId, {
      stage: JOB_PROGRESS_STAGES.finalizing,
      percent: 99,
    });

    const output = {
      provider: "ffmpeg",
      storage_path: outPath,
      final_asset_id: assetRow.id,
      captions_applied: captionsApplied,
    };

    const { error: finErr } = await supabase
      .from("generation_jobs")
      .update({
        status: "succeeded",
        provider: "ffmpeg",
        output,
        error: null,
        progress: null,
      })
      .eq("id", jobId);

    if (finErr) {
      return { ok: false, error: finErr.message };
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        provider: "ffmpeg",
        error: msg.slice(0, 2000),
        progress: null,
      })
      .eq("id", jobId);
    return { ok: false, error: msg };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
