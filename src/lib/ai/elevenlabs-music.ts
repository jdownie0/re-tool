/**
 * Server-only: Eleven Labs music composition (MP3).
 * https://elevenlabs.io/docs/api-reference/music/compose
 */

import { MUSIC_PRESETS } from "@/lib/wizard/constants";
import { getElevenLabsApiKey } from "@/lib/ai/elevenlabs-env";

const DEFAULT_MODEL = "music_v1";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** API allows 3s–10m; we align with project video length by default. */
export const ELEVENLABS_MIN_MUSIC_MS = 3_000;
export const ELEVENLABS_MAX_MUSIC_MS = 600_000;

export function buildMusicPromptForElevenLabs(
  presetId: string | null,
  userPrompt: string,
): string {
  const parts: string[] = [];
  if (presetId) {
    const preset = MUSIC_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      parts.push(
        `Instrumental background music for a real estate video: ${preset.title}. Style: ${preset.subtitle}.`,
      );
    }
  }
  if (userPrompt.trim()) {
    parts.push(userPrompt.trim());
  }
  if (parts.length === 0) {
    return "Uplifting instrumental background music for a real estate home tour video, no vocals.";
  }
  return `${parts.join(" ")} Professional, polished, suitable as background under narration.`;
}

export function clampMusicLengthMs(ms: number): number {
  return Math.min(ELEVENLABS_MAX_MUSIC_MS, Math.max(ELEVENLABS_MIN_MUSIC_MS, ms));
}

export async function composeMusicMp3(
  prompt: string,
  musicLengthMs: number,
): Promise<{ ok: true; buffer: ArrayBuffer } | { ok: false; error: string }> {
  const key = getElevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Eleven Labs API key not configured" };
  }

  const lengthMs = clampMusicLengthMs(musicLengthMs);
  const modelId = process.env.ELEVENLABS_MUSIC_MODEL?.trim() || DEFAULT_MODEL;
  const outputFormat =
    process.env.ELEVENLABS_MUSIC_OUTPUT_FORMAT?.trim() || DEFAULT_OUTPUT_FORMAT;

  const url = new URL("https://api.elevenlabs.io/v1/music");
  url.searchParams.set("output_format", outputFormat);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: modelId,
      prompt,
      music_length_ms: lengthMs,
      force_instrumental: true,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return {
      ok: false,
      error: `Eleven Labs music failed (${res.status}): ${errBody.slice(0, 400)}`,
    };
  }

  const buffer = await res.arrayBuffer();
  return { ok: true, buffer };
}
