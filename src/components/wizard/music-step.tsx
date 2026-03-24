"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { MUSIC_PRESETS } from "@/lib/wizard/constants";
import type { WizardMetadata } from "@/lib/wizard/types";
import {
  enqueueMockJob,
  generateMusicWithElevenLabs,
  setMusicSkipped,
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
  wizard: WizardMetadata;
  photos: PhotoRow[];
  elevenLabsConfigured: boolean;
  /** Signed URL for latest `music` asset in `generated-audio`, when present. */
  musicAudioUrl: string | null;
};

export function MusicStep({
  projectId,
  wizard,
  elevenLabsConfigured,
  musicAudioUrl,
}: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(wizard.musicPrompt);
  const [preset, setPreset] = useState<string | null>(wizard.musicPreset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrompt(wizard.musicPrompt);
    setPreset(wizard.musicPreset);
  }, [wizard.musicPrompt, wizard.musicPreset]);

  const selectPreset = async (id: string) => {
    setPreset(id);
    await updateWizardMetadata(projectId, { musicPreset: id });
    router.refresh();
  };

  const onPromptBlur = async () => {
    if (prompt === wizard.musicPrompt) return;
    await updateWizardMetadata(projectId, { musicPrompt: prompt });
    router.refresh();
  };

  const generateMusic = async () => {
    if (!preset && !prompt.trim()) {
      setError("Pick a mood or describe a style.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateWizardMetadata(projectId, {
        musicPreset: preset,
        musicPrompt: prompt,
        musicSkipped: false,
      });
      if (elevenLabsConfigured) {
        await generateMusicWithElevenLabs(projectId);
      } else {
        await enqueueMockJob(
          projectId,
          "music",
          { preset: preset ?? "custom", prompt },
          `music-${projectId}`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    setError(null);
    try {
      await setMusicSkipped(projectId, true);
      router.push(`/app/projects/${projectId}/wizard/review`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const canGenerate = Boolean(preset || prompt.trim());

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Background music</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {elevenLabsConfigured
            ? "Pick a mood or describe a style. We generate instrumental background audio with Eleven Labs (length matches your video duration)."
            : "Pick a mood or describe a style. Without an Eleven Labs key, this step uses an instant mock placeholder."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {MUSIC_PRESETS.map((m) => {
          const active = preset === m.id;
          return (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => selectPreset(m.id)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted/60",
              )}
            >
              <div className="font-medium">{m.title}</div>
              <div
                className={cn(
                  "mt-0.5 text-xs",
                  active ? "opacity-90" : "text-muted-foreground",
                )}
              >
                {m.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="music-prompt">Or describe a style</Label>
        <Textarea
          id="music-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={onPromptBlur}
          placeholder="e.g. uplifting acoustic guitar, feel-good"
        />
      </div>

      {wizard.musicMockReady && !wizard.musicSkipped ? (
        <div className="bg-muted/40 space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">
            {musicAudioUrl ? "Background music ready" : "Mock music track ready"}
          </p>
          {musicAudioUrl ? (
            <audio
              controls
              className="h-9 w-full max-w-md"
              src={musicAudioUrl}
              preload="metadata"
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" />
              {(wizard.musicDurationMs ?? 20_000) / 1000}s placeholder duration
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className="gap-2"
          disabled={busy || !canGenerate}
          onClick={generateMusic}
        >
          <Sparkles className="size-4" />
          {elevenLabsConfigured ? "Generate music" : "Generate music (mock)"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={skip}>
          Skip background music
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy || (!wizard.musicMockReady && !wizard.musicSkipped)}
          onClick={() => router.push(`/app/projects/${projectId}/wizard/review`)}
        >
          Continue to review
        </Button>
        <Link
          href={`/app/projects/${projectId}/wizard/arrange`}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          Back
        </Link>
      </div>
    </div>
  );
}
