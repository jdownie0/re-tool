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
  enqueueSceneVideoJobs,
  processOneQueuedSceneVideoJob,
  resetFailedSceneVideoJobs,
  setCaptionsEnabled,
} from "@/app/app/projects/[id]/wizard/actions";

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
  videoClips: ClipRow[];
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

export function ReviewStep({
  projectId,
  wizard,
  photos,
  sceneJobs,
  videoClips,
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

  const onGenerateClips = async () => {
    setBusy(true);
    setError(null);
    try {
      await enqueueSceneVideoJobs(projectId);
      for (;;) {
        const r = await processOneQueuedSceneVideoJob(projectId);
        if (!r.ok) {
          setError(r.error);
          break;
        }
        if (r.remaining === 0) break;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clip generation failed");
    } finally {
      setBusy(false);
    }
  };

  const onRetryFailed = async () => {
    setError(null);
    try {
      await resetFailedSceneVideoJobs(projectId);
      await onGenerateClips();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  };

  const hasFailed = sceneJobs.some((j) => j.status === "failed");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Final review</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Generate per-scene clips (Fal.ai) when <code className="text-xs">FAL_AI_KEY</code> is set
          server-side; otherwise jobs complete as mocks.
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
                {job ? (
                  <span
                    className="bg-background/90 absolute top-1 right-1 z-10 rounded px-1 text-[9px] font-medium capitalize"
                    title={job.error ?? undefined}
                  >
                    {statusLabel(job.status)}
                  </span>
                ) : null}
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
        {hasFailed ? (
          <p className="text-destructive text-xs">
            One or more clips failed. Check job errors below or retry.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide uppercase">Audio</h3>
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Voiceover (mock)</p>
          <MockWave durationSec={(wizard.voiceDurationMs ?? 18000) / 1000} />
        </div>
        {!wizard.musicSkipped && wizard.musicMockReady ? (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Background music (mock)</p>
            <MockWave durationSec={20} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Background music skipped.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium tracking-wide uppercase">Script</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{scriptPreview || "—"}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium tracking-wide uppercase">Scene video jobs</h3>
        <ul className="text-muted-foreground space-y-1 text-xs">
          {sceneJobs.length === 0 ? (
            <li>No scene jobs yet — generate clips to enqueue one job per photo.</li>
          ) : (
            sceneJobs.map((j) => {
              const input =
                j.input && typeof j.input === "object"
                  ? (j.input as { photo_asset_id?: string })
                  : null;
              return (
                <li key={j.id} className="font-mono">
                  {input?.photo_asset_id?.slice(0, 8) ?? "—"}… — {j.status}
                  {j.error ? ` — ${j.error.slice(0, 120)}` : ""}
                </li>
              );
            })
          )}
        </ul>
      </section>

      <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="captions">Auto-generate captions</Label>
          <p className="text-muted-foreground text-xs">
            Burned-in subtitles synced to your voiceover (not rendered in mock mode).
          </p>
        </div>
        <Switch
          id="captions"
          checked={wizard.captionsEnabled}
          onCheckedChange={onCaptions}
        />
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy || photos.length === 0}
          onClick={onGenerateClips}
        >
          {busy || queuedOrRunning ? "Working…" : "Generate video clips"}
        </Button>
        {hasFailed ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onRetryFailed}>
            Retry failed clips
          </Button>
        ) : null}
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
    </div>
  );
}

function formatMmSs(totalSeconds: number) {
  const s = Math.floor(totalSeconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function MockWave({ durationSec }: { durationSec: number }) {
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
