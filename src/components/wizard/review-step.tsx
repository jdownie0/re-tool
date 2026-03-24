"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { WizardMetadata } from "@/lib/wizard/types";
import {
  enqueueFinalRender,
  enqueueSceneVideoJobs,
  resetFailedSceneVideoJobs,
  scheduleComposeProcessing,
  scheduleSceneVideoProcessing,
  setCaptionsEnabled,
} from "@/app/app/projects/[id]/wizard/actions";
import { stageLabel } from "@/lib/jobs/job-progress";
import { Progress } from "@/components/ui/progress";

type PhotoRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  sort_order: number | null;
};

type SceneJobRow = {
  id: string;
  status: string;
  error: string | null;
  input: unknown;
  output: unknown;
  created_at: string;
  updated_at?: string;
  progress: unknown;
};

type ComposeJobRow = {
  id: string;
  status: string;
  error: string | null;
  input: unknown;
  output: unknown;
  created_at: string;
  updated_at?: string;
  progress: unknown;
};

type ClipRow = {
  id: string;
  storage_path: string;
  sort_order: number | null;
  duration_ms: number | null;
};

type Props = {
  projectId: string;
  wizard: WizardMetadata;
  photos: PhotoRow[];
  sceneJobs: SceneJobRow[];
  /** Latest final-render compose job, if any. */
  composeJob: ComposeJobRow | null;
  videoClips: ClipRow[];
  /** Signed URL for generated voiceover MP3 (`voice_sample`), when present. */
  voiceoverAudioUrl: string | null;
  /** Signed URL for generated background music, when present. */
  musicAudioUrl: string | null;
  /** Signed URL for assembled final MP4 in `renders`, when present. */
  finalRenderUrl: string | null;
};

function jobForPhoto(photoId: string, jobs: SceneJobRow[]): SceneJobRow | undefined {
  return jobs.find((j) => {
    const input = j.input && typeof j.input === "object" ? (j.input as { photo_asset_id?: string }) : null;
    return input?.photo_asset_id === photoId;
  });
}

function clipForPhoto(photoId: string, clips: ClipRow[]): ClipRow | undefined {
  return clips.find((c) => c.storage_path.includes(`scene-${photoId}`));
}

function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function sceneIndexFromInput(job: SceneJobRow): number {
  const input =
    job.input && typeof job.input === "object"
      ? (job.input as { scene_index?: number })
      : null;
  if (typeof input?.scene_index === "number" && Number.isFinite(input.scene_index)) {
    return input.scene_index;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** 1-based label aligned with photo order (`scene_index` on the job is 0-based). */
function getVideoNumber(job: SceneJobRow, orderIndex: number): number {
  const idx = sceneIndexFromInput(job);
  if (idx !== Number.MAX_SAFE_INTEGER) {
    return idx + 1;
  }
  return orderIndex + 1;
}

function parseJobProgress(progress: unknown): {
  label: string;
  percent: number | null;
} | null {
  if (!progress || typeof progress !== "object") return null;
  const p = progress as Record<string, unknown>;
  const stage = typeof p.stage === "string" ? p.stage : "";
  const label =
    typeof p.label === "string" && p.label.trim()
      ? p.label
      : stageLabel(stage);
  const pct = p.percent;
  const percent =
    typeof pct === "number" && Number.isFinite(pct)
      ? Math.min(100, Math.max(0, pct))
      : null;
  return { label, percent };
}

function estimateEtaSeconds(
  updatedAt: string,
  percent: number | null,
): number | null {
  if (percent == null || percent < 5 || percent >= 99) return null;
  const elapsedSec = (Date.now() - new Date(updatedAt).getTime()) / 1000;
  if (elapsedSec < 2) return null;
  const eta = elapsedSec * (100 / percent - 1);
  if (!Number.isFinite(eta) || eta < 0) return null;
  return Math.min(eta, 600);
}

function formatEtaLine(seconds: number): string {
  if (seconds > 600) return "More than 10 min remaining";
  if (seconds >= 90) return `About ${Math.ceil(seconds / 60)} min remaining`;
  if (seconds >= 60) return "About 1 min remaining";
  return `About ${Math.ceil(seconds)} s remaining`;
}

function JobListRow({
  title,
  job,
}: {
  title: string;
  job: {
    status: string;
    error: string | null;
    created_at: string;
    updated_at?: string;
    progress: unknown;
  };
}) {
  const parsed = parseJobProgress(job.progress);
  const pct = parsed?.percent ?? null;
  const label = parsed?.label ?? statusLabel(job.status);
  const updatedAt = job.updated_at ?? job.created_at;
  const eta =
    job.status === "running" || job.status === "queued"
      ? estimateEtaSeconds(updatedAt, pct)
      : null;
  const indeterminate =
    (job.status === "running" || job.status === "queued") && pct == null;

  return (
    <li className="border-border/80 space-y-1.5 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="capitalize">{job.status}</span>
      </div>
      {job.status === "running" || job.status === "queued" ? (
        <>
          <p className="text-muted-foreground text-[11px] leading-snug">{label}</p>
          <Progress
            value={pct ?? undefined}
            indeterminate={indeterminate}
            className="h-1.5"
          />
          {eta != null ? (
            <p className="text-muted-foreground text-[11px] tabular-nums">
              {formatEtaLine(eta)}
            </p>
          ) : null}
        </>
      ) : null}
      {job.error ? (
        <p className="text-destructive text-[11px] break-words whitespace-pre-wrap">
          {job.error}
        </p>
      ) : null}
    </li>
  );
}

const COMPOSE_POLL_INTERVAL_MS = 2000;
/** Max time to wait for compose (background FFmpeg may run many minutes). */
const COMPOSE_MAX_WAIT_MS = 60 * 60 * 1000;

async function waitForComposeJobComplete(
  jobId: string,
  onProgress?: () => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const deadline = Date.now() + COMPOSE_MAX_WAIT_MS;
  let ticks = 0;
  while (Date.now() < deadline) {
    const { data: job, error } = await supabase
      .from("generation_jobs")
      .select("status, error")
      .eq("id", jobId)
      .single();
    if (error) {
      return { ok: false, error: error.message };
    }
    if (job?.status === "succeeded") {
      return { ok: true };
    }
    if (job?.status === "failed") {
      return {
        ok: false,
        error: job.error ?? "Final render failed",
      };
    }
    await new Promise((r) => setTimeout(r, COMPOSE_POLL_INTERVAL_MS));
    ticks += 1;
    if (ticks % 3 === 0) {
      onProgress?.();
    }
  }
  return {
    ok: false,
    error:
      "Export is still running or stalled. Use “Resume background worker” if needed, then open Share from the top when the job shows Done.",
  };
}

function ThumbnailJobOverlay({ job }: { job: SceneJobRow }) {
  if (job.status !== "queued" && job.status !== "running") {
    return (
      <span
        className="bg-background/90 absolute top-1 right-1 z-10 rounded px-1 text-[9px] font-medium capitalize"
        title={job.error ?? undefined}
      >
        {statusLabel(job.status)}
      </span>
    );
  }
  const parsed = parseJobProgress(job.progress);
  const pct = parsed?.percent ?? null;
  const label = (parsed?.label ?? statusLabel(job.status)).slice(0, 32);
  const eta = estimateEtaSeconds(job.updated_at ?? job.created_at, pct);

  return (
    <div className="bg-background/95 absolute right-0 bottom-0 left-0 z-10 space-y-0.5 px-1 py-0.5">
      <p className="text-[8px] leading-none font-medium">{label}</p>
      <Progress
        value={pct ?? undefined}
        indeterminate={pct == null}
        className="h-0.5"
      />
      {eta != null ? (
        <p className="text-muted-foreground text-[7px] tabular-nums leading-none">
          {formatEtaLine(eta)}
        </p>
      ) : null}
    </div>
  );
}

export function ReviewStep({
  projectId,
  wizard,
  photos,
  sceneJobs,
  composeJob,
  videoClips,
  voiceoverAudioUrl,
  musicAudioUrl,
  finalRenderUrl,
}: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const next: Record<string, string> = {};
      for (const p of photos) {
        const { data } = await supabase.storage
          .from("listing-photos")
          .createSignedUrl(p.storage_path, 3600);
        if (data?.signedUrl) next[p.id] = data.signedUrl;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const next: Record<string, string> = {};
      for (const c of videoClips) {
        const { data } = await supabase.storage
          .from("generated-video")
          .createSignedUrl(c.storage_path, 3600);
        if (data?.signedUrl) next[c.id] = data.signedUrl;
      }
      if (!cancelled) setClipUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoClips]);

  const onCaptions = async (checked: boolean) => {
    await setCaptionsEnabled(projectId, checked);
    router.refresh();
  };

  const scriptPreview =
    wizard.scriptDraft.trim().slice(0, 280) +
    (wizard.scriptDraft.length > 280 ? "…" : "");

  const queuedOrRunning = sceneJobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const composeQueuedOrRunning =
    composeJob &&
    (composeJob.status === "queued" || composeJob.status === "running");

  useEffect(() => {
    if (!queuedOrRunning && !composeQueuedOrRunning) return;
    const id = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [queuedOrRunning, composeQueuedOrRunning, router]);

  const onGenerateClips = async () => {
    setBusy(true);
    setError(null);
    try {
      await enqueueSceneVideoJobs(projectId);
      await scheduleSceneVideoProcessing(projectId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clip generation failed");
    } finally {
      setBusy(false);
    }
  };

  const onRetryFailed = async () => {
    setError(null);
    setBusy(true);
    try {
      await resetFailedSceneVideoJobs(projectId);
      await scheduleSceneVideoProcessing(projectId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  const hasFailed = sceneJobs.some((j) => j.status === "failed");
  const hasQueued =
    sceneJobs.some((j) => j.status === "queued") ||
    composeJob?.status === "queued";

  const onResumeProcessing = async () => {
    setBusy(true);
    setError(null);
    try {
      await scheduleSceneVideoProcessing(projectId);
      await scheduleComposeProcessing(projectId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume processing");
    } finally {
      setBusy(false);
    }
  };

  const clipsReady =
    photos.length > 0 &&
    videoClips.length >= photos.length &&
    !sceneJobs.some((j) => j.status === "queued" || j.status === "running");

  const composeBusy =
    composeJob &&
    (composeJob.status === "queued" || composeJob.status === "running");

  const onExportFinal = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enqueueFinalRender(projectId);
      const wait = await waitForComposeJobComplete(result.jobId, () => {
        router.refresh();
      });
      if (!wait.ok) {
        throw new Error(wait.error);
      }
      router.push(`/app/projects/${projectId}/wizard/export`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const everyPhotoHasClip =
    photos.length > 0 &&
    photos.every((p) => Boolean(clipForPhoto(p.id, videoClips)));

  const allSceneClipsSucceeded =
    everyPhotoHasClip &&
    (sceneJobs.length === 0 ||
      sceneJobs.every((j) => j.status === "succeeded"));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Final review</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Each scene clip can take up to about two minutes. Use{" "}
          <span className="font-medium text-foreground">Scene video jobs</span> below for status while
          they run; when clips are ready, export your{" "}
          <span className="font-medium text-foreground">final video</span> in the section after that.
          If a job failed, use <span className="font-medium text-foreground">Retry failed clips</span>.
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium tracking-wide uppercase">Scenes</h3>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => {
            const job = jobForPhoto(p.id, sceneJobs);
            const clip = clipForPhoto(p.id, videoClips);
            const clipSrc = clip ? clipUrls[clip.id] : null;
            return (
              <div
                key={p.id}
                className="relative h-28 w-36 shrink-0 overflow-hidden rounded-md border bg-muted"
              >
                <span className="bg-background/80 absolute top-1 left-1 z-10 rounded px-1 text-[10px] font-medium">
                  {i + 1}
                </span>
                {job ? <ThumbnailJobOverlay job={job} /> : null}
                {clipSrc ? (
                  <video
                    src={clipSrc}
                    className="size-full object-cover"
                    controls
                    playsInline
                    muted
                  />
                ) : urls[p.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[p.id]} alt="" className="size-full object-cover" />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="captions">Auto-generate captions</Label>
          <p className="text-muted-foreground text-xs">
            Burned-in subtitles synced to your voiceover.
          </p>
        </div>
        <Switch
          id="captions"
          checked={wizard.captionsEnabled}
          onCheckedChange={onCaptions}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide uppercase">Audio</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">
              {voiceoverAudioUrl ? "Voiceover" : "Voiceover (mock)"}
            </p>
            {voiceoverAudioUrl ? (
              <audio
                controls
                className="h-9 w-full min-w-0"
                src={voiceoverAudioUrl}
                preload="metadata"
              />
            ) : (
              <WaveformPreview durationSec={(wizard.voiceDurationMs ?? 18000) / 1000} />
            )}
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            {!wizard.musicSkipped && wizard.musicMockReady ? (
              <>
                <p className="text-sm font-medium">
                  Background music
                </p>
                {musicAudioUrl ? (
                  <audio
                    controls
                    className="h-9 w-full min-w-0"
                    src={musicAudioUrl}
                    preload="metadata"
                  />
                ) : (
                  <WaveformPreview
                    durationSec={(wizard.musicDurationMs ?? 20_000) / 1000}
                  />
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Background music</p>
                <p className="text-muted-foreground text-sm">Skipped for this project.</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium tracking-wide uppercase">Script</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{scriptPreview || "—"}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium tracking-wide uppercase">Scene video jobs</h3>
        <ul className="text-muted-foreground space-y-2 text-xs">
          {sceneJobs.length === 0 ? (
            <li>
              {everyPhotoHasClip
                ? "All scene clips finished successfully."
                : videoClips.length > 0
                  ? "Some clips are ready. Generate any missing scenes if needed."
                  : "No video jobs yet — generate clips first."}
            </li>
          ) : (
            [...sceneJobs]
              .sort((a, b) => {
                const da = sceneIndexFromInput(a) - sceneIndexFromInput(b);
                if (da !== 0) return da;
                return a.created_at.localeCompare(b.created_at);
              })
              .map((j, i) => (
                <JobListRow
                  key={j.id}
                  title={`Video #${getVideoNumber(j, i)}`}
                  job={j}
                />
              ))
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide uppercase">Final video</h3>
        {finalRenderUrl ? (
          <div className="space-y-3">
            <video
              src={finalRenderUrl}
              controls
              className="aspect-video w-full max-w-lg rounded-md border bg-black"
              playsInline
            />
            <Link
              href={`/app/projects/${projectId}/wizard/export`}
              className={cn(buttonVariants({ variant: "secondary" }), "inline-flex")}
            >
              Download &amp; share
            </Link>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Export stitches your scene clips with voiceover (and optional music) into one MP4.
          </p>
        )}
        {composeJob?.status === "succeeded" && !finalRenderUrl ? (
          <p className="text-muted-foreground text-xs" role="status">
            No preview file in storage yet. Click <span className="font-medium">Re-export final video</span>{" "}
            to generate a playable MP4 (older exports may predate this step).
          </p>
        ) : null}
        {composeJob ? (
          <ul className="space-y-2 text-xs">
            <JobListRow title="Final render" job={composeJob} />
          </ul>
        ) : null}
        <Button
          type="button"
          disabled={busy || !clipsReady || !!composeBusy}
          onClick={onExportFinal}
        >
          {busy || composeBusy
            ? "Rendering final video…"
            : composeJob?.status === "succeeded"
              ? "Re-export final video"
              : "Export final video"}
        </Button>
        {!clipsReady ? (
          <p className="text-muted-foreground text-xs">
            Finish generating all scene clips before exporting.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href={`/app/projects/${projectId}/wizard/music`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Back
          </Link>
          <Link href="/app/projects" className={cn(buttonVariants({ variant: "ghost" }))}>
            All projects
          </Link>
        </div>
      </section>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {(!allSceneClipsSucceeded || hasQueued || hasFailed) ? (
        <div className="flex flex-wrap gap-3">
          {!allSceneClipsSucceeded ? (
            <Button
              type="button"
              disabled={
                busy || photos.length === 0 || queuedOrRunning || !!composeBusy
              }
              onClick={onGenerateClips}
            >
              {busy ? "Starting…" : "Generate video clips"}
            </Button>
          ) : null}
          {hasQueued ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onResumeProcessing}>
              Resume background worker
            </Button>
          ) : null}
          {hasFailed ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onRetryFailed}>
              Retry failed clips
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatMmSs(totalSeconds: number) {
  const s = Math.floor(totalSeconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function WaveformPreview({ durationSec }: { durationSec: number }) {
  const bars = Array.from({ length: 36 }, (_, i) => 25 + ((i * 13) % 50));
  return (
    <div className="flex items-center gap-2">
      <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs">
        ▶
      </div>
      <div className="flex h-9 flex-1 items-end gap-px">
        {bars.map((h, i) => (
          <div
            key={i}
            className="bg-foreground/25 w-full min-w-px rounded-sm"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
        {formatMmSs(durationSec)}
      </span>
    </div>
  );
}
