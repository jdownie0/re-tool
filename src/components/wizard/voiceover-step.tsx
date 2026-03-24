"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { WizardVoiceOption } from "@/lib/ai/elevenlabs-voices";
import type { WizardMetadata } from "@/lib/wizard/types";
import {
  DEFAULT_WIZARD_DURATION_SECONDS,
  requiredPhotosForDuration,
  VOICE_PRESETS,
} from "@/lib/wizard/constants";
import {
  generateListingScriptWithOpenAI,
  generateVoiceoverWithElevenLabs,
  updateWizardMetadata,
} from "@/app/app/projects/[id]/wizard/actions";

type PhotoRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  sort_order: number | null;
};

type Props = {
  projectId: string;
  durationSeconds: number | null;
  wizard: WizardMetadata;
  photos: PhotoRow[];
  /** True when listing snapshot has text we can send to OpenAI. */
  hasListingContext: boolean;
  /** Server has `OPEN_AI_SECRET` or `OPENAI_API_KEY` (listing-based script generation). */
  openaiConfigured: boolean;
  /** Server has `ELEVEN_LABS_KEY_ID` (or legacy Eleven Labs env) for TTS / voices. */
  elevenLabsConfigured: boolean;
  /** From Eleven Labs `GET /v1/voices` when configured, else static fallback options. */
  voiceOptions: WizardVoiceOption[];
  /** Signed URL for generated voice_sample MP3, when present. */
  voiceoverAudioUrl: string | null;
};

/** Eleven Labs `voice_id` values are alphanumeric strings, not UUIDs. Only our static preset rows lack a real TTS id. */
const MOCK_VOICE_IDS = new Set<string>(VOICE_PRESETS.map((p) => p.id));

function canPreviewThisVoice(voiceId: string): boolean {
  return !MOCK_VOICE_IDS.has(voiceId);
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function VoiceoverStep({
  projectId,
  durationSeconds,
  wizard,
  hasListingContext,
  openaiConfigured,
  elevenLabsConfigured,
  voiceOptions,
  voiceoverAudioUrl,
}: Props) {
  const router = useRouter();
  const [script, setScript] = useState(wizard.scriptDraft);
  const validVoiceIds = useMemo(
    () => new Set(voiceOptions.map((o) => o.id)),
    [voiceOptions],
  );
  const [preset, setPreset] = useState(() =>
    validVoiceIds.has(wizard.voicePreset)
      ? wizard.voicePreset
      : (voiceOptions[0]?.id ?? wizard.voicePreset),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewPlaybackError, setPreviewPlaybackError] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewPlayingId, setPreviewPlayingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  const revokePreviewBlobUrl = () => {
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
  };

  const stopPreviewPlayback = () => {
    revokePreviewBlobUrl();
    const a = previewAudioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      a.load();
    }
    previewAudioRef.current = null;
    setPreviewPlayingId(null);
  };

  useEffect(() => {
    return () => {
      revokePreviewBlobUrl();
      const a = previewAudioRef.current;
      if (a) {
        a.pause();
        a.src = "";
      }
      previewAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    setScript(wizard.scriptDraft);
  }, [wizard.scriptDraft]);

  useEffect(() => {
    if (validVoiceIds.has(wizard.voicePreset)) {
      setPreset(wizard.voicePreset);
    }
  }, [wizard.voicePreset, validVoiceIds]);

  useEffect(() => {
    if (voiceOptions.length === 0) return;
    if (validVoiceIds.has(wizard.voicePreset)) return;
    const next = voiceOptions[0]!.id;
    void (async () => {
      await updateWizardMetadata(projectId, { voicePreset: next });
      setPreset(next);
      router.refresh();
    })();
  }, [wizard.voicePreset, voiceOptions, validVoiceIds, projectId, router]);

  const duration = durationSeconds ?? DEFAULT_WIZARD_DURATION_SECONDS;
  const slots = Math.ceil(duration / 4);
  const targetLow = Math.max(20, slots * 8);
  const targetHigh = slots * 12;
  const words = wordCount(script);
  const lengthOk = words >= targetLow && words <= targetHigh + 10;

  const onScriptBlur = async () => {
    if (script === wizard.scriptDraft) return;
    await updateWizardMetadata(projectId, { scriptDraft: script });
    router.refresh();
  };

  const onPresetChange = async (v: string | null) => {
    if (!v) return;
    setPreset(v);
    await updateWizardMetadata(projectId, { voicePreset: v });
    router.refresh();
  };

  const startPreviewPlayback = async (row: WizardVoiceOption) => {
    if (!elevenLabsConfigured || !canPreviewThisVoice(row.id)) return;
    stopPreviewPlayback();
    setPreviewLoadingId(row.id);
    setPreviewPlaybackError(null);
    try {
      const res = await fetch("/api/elevenlabs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          voiceId: row.id,
          projectId,
          voiceName: row.name,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `Preview failed (${res.status})`,
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      previewBlobUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;

      audio.addEventListener("ended", () => {
        revokePreviewBlobUrl();
        previewAudioRef.current = null;
        setPreviewPlayingId(null);
      });

      audio.addEventListener(
        "error",
        () => {
          revokePreviewBlobUrl();
          previewAudioRef.current = null;
          setPreviewPlayingId(null);
          setPreviewPlaybackError("Could not play audio preview.");
        },
        { once: true },
      );

      await audio.play();
      setPreviewPlayingId(row.id);
    } catch (e) {
      setPreviewPlaybackError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const onPreviewButtonClick = (row: WizardVoiceOption) => {
    if (!elevenLabsConfigured || !canPreviewThisVoice(row.id)) return;
    if (previewPlayingId === row.id) {
      stopPreviewPlayback();
      return;
    }
    void startPreviewPlayback(row);
  };

  const generateScriptFromListing = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await generateListingScriptWithOpenAI(projectId);
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to generate script");
    } finally {
      setBusy(false);
    }
  };

  const generateVoice = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await updateWizardMetadata(projectId, { scriptDraft: script, voicePreset: preset });
      await generateVoiceoverWithElevenLabs(projectId);
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to generate voiceover");
    } finally {
      setBusy(false);
    }
  };

  const canGenerateVoiceover =
    elevenLabsConfigured &&
    canPreviewThisVoice(preset) &&
    Boolean(script.trim());

  const targetHint = useMemo(
    () =>
      `Aim for roughly ${targetLow}–${targetHigh} words for ~${duration}s video (${requiredPhotosForDuration(duration)} scenes).`,
    [duration, targetHigh, targetLow],
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Voiceover script</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Draft your script, generate from your listing with OpenAI when available, then create a
          voiceover track.
        </p>
        {openaiConfigured && hasListingContext ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Listing data is loaded — you can generate a script from it below.
          </p>
        ) : null}
        {openaiConfigured && !hasListingContext ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Add a listing URL and complete the photos step so we can pull text for script
            generation.
          </p>
        ) : null}
        {!openaiConfigured ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Set <code className="text-foreground/90">OPEN_AI_SECRET</code> on the server to enable
            listing-based script generation.
          </p>
        ) : null}
      </div>

      <div className="grid max-w-4xl gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <Label className="text-base">Voice</Label>
          {!elevenLabsConfigured ? (
            <p className="text-muted-foreground text-xs">
              Add <code className="text-foreground/90">ELEVEN_LABS_KEY_ID</code> for the full voice
              list and audio previews.
            </p>
          ) : null}
        </div>

        <div className="border-border overflow-hidden rounded-lg border">
          <div className="max-h-[min(70vh,28rem)] overflow-auto">
            <table className="w-full min-w-[20rem] table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th className="w-12 px-3 py-2.5 text-left font-medium" scope="col">
                    <span className="sr-only">Selected</span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium" scope="col">
                    Voice
                  </th>
                  <th className="w-36 px-3 py-2.5 text-right font-medium" scope="col">
                    Preview
                  </th>
                </tr>
              </thead>
              <tbody>
                {voiceOptions.map((row) => {
                  const selected = preset === row.id;
                  const canPreview =
                    elevenLabsConfigured && canPreviewThisVoice(row.id);
                  const isLoading = previewLoadingId === row.id;
                  const isPlaying = previewPlayingId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b transition-colors last:border-0",
                        selected ? "bg-primary/[0.06]" : "hover:bg-muted/40",
                      )}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="radio"
                          name={`voice-${projectId}`}
                          className="size-4 accent-primary"
                          checked={selected}
                          onChange={() => void onPresetChange(row.id)}
                          aria-label={`Select ${row.name}`}
                        />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <button
                          type="button"
                          className={cn(
                            "w-full truncate text-left",
                            selected ? "font-medium" : "",
                          )}
                          title={row.label}
                          onClick={() => void onPresetChange(row.id)}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right align-middle">
                        <Button
                          type="button"
                          variant={isPlaying ? "secondary" : "outline"}
                          size="sm"
                          className="gap-1.5"
                          disabled={!canPreview || isLoading}
                          onClick={() => onPreviewButtonClick(row)}
                          title={
                            canPreview
                              ? isPlaying
                                ? "Stop playback"
                                : "Play preview instructions"
                              : "Requires Eleven Labs voices"
                          }
                          aria-label={
                            isPlaying
                              ? `Stop preview for ${row.name}`
                              : `Preview voice ${row.name}`
                          }
                        >
                          {isLoading ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin" />
                          ) : isPlaying ? (
                            <Square className="size-3.5 shrink-0" />
                          ) : (
                            <Volume2 className="size-3.5 shrink-0" />
                          )}
                          {isPlaying ? "Stop" : "Preview"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="script">Script</Label>
        <Textarea
          id="script"
          rows={8}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onBlur={onScriptBlur}
          placeholder="Describe the property in a natural voiceover style..."
          className="min-h-[180px] resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{words} words</span>
          {lengthOk ? (
            <span className="text-emerald-600 dark:text-emerald-400">Good length range</span>
          ) : (
            <span className="text-muted-foreground">{targetHint}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy || !openaiConfigured || !hasListingContext}
            onClick={generateScriptFromListing}
          >
            Generate script from listing
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy || !canGenerateVoiceover}
            onClick={generateVoice}
          >
            {voiceoverAudioUrl ? "Regenerate Voice over" : "Generate Voice over"}
          </Button>
        </div>
      </div>

      {voiceoverAudioUrl ? <VoiceoverAudioPlayer src={voiceoverAudioUrl} /> : null}

      {actionError ? (
        <p className="text-destructive text-sm" role="alert">
          {actionError}
        </p>
      ) : null}
      {previewPlaybackError ? (
        <p className="text-destructive text-sm" role="alert">
          {previewPlaybackError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={!wizard.voiceMockReady || busy}
          onClick={() => router.push(`/app/projects/${projectId}/wizard/arrange`)}
        >
          Continue to arrange
        </Button>
        <Link
          href={`/app/projects/${projectId}/wizard/photos`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back
        </Link>
      </div>
    </div>
  );
}

function VoiceoverAudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [durationLabel, setDurationLabel] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.src = src;
    el.load();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onMeta = () => {
      if (el.duration && Number.isFinite(el.duration)) {
        setDurationLabel(`${Math.round(el.duration)}s`);
      }
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [src]);

  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <audio ref={ref} preload="metadata" />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          const a = ref.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        aria-label={playing ? "Pause voiceover" : "Play voiceover"}
      >
        {playing ? <Pause className="size-4 shrink-0" /> : <Play className="size-4 shrink-0" />}
        {playing ? "Pause" : "Play"}
      </Button>
      <span className="text-sm font-medium">Voiceover</span>
      {durationLabel ? (
        <span className="text-muted-foreground text-xs tabular-nums">{durationLabel}</span>
      ) : null}
    </div>
  );
}
