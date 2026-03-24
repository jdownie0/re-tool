/**
 * Server-only: Eleven Labs text-to-speech (MP3).
 * https://elevenlabs.io/docs/api-reference/text-to-speech
 */

import { getElevenLabsApiKey } from "@/lib/ai/elevenlabs-env";
import { normalizeSpokenTextForTts } from "@/lib/ai/tts-spoken-normalize";

/** Wizard voice table: TTS lines for the preview button (server + client copy in sync via `voiceName`). */
export function buildVoicePreviewNarration(voiceName: string): string {
  const safe = voiceName.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 120);
  const name = safe.length > 0 ? safe : "this voice";
  return `Hello, I'm ${name}. When you're ready to proceed select me by clicking the circle to the left of my name then click generate voiceover to hear your script with my voice applied.`;
}

const DEFAULT_MODEL = "eleven_multilingual_v2";

/** Eleven Labs single-request text length guard (see model limits in dashboard). */
export const ELEVENLABS_MAX_TTS_SCRIPT_CHARS = 5000;

export async function synthesizeVoiceMp3(
  voiceId: string,
  text: string,
): Promise<{ ok: true; buffer: ArrayBuffer } | { ok: false; error: string }> {
  const key = getElevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Eleven Labs API key not configured" };
  }

  const modelId = process.env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_MODEL;

  const skipSpoken =
    process.env.ELEVENLABS_TTS_SKIP_SPOKEN_NORMALIZE === "1" ||
    process.env.ELEVENLABS_TTS_SKIP_SPOKEN_NORMALIZE === "true";
  const spokenText = skipSpoken ? text : normalizeSpokenTextForTts(text);

  /**
   * Eleven Labs `apply_text_normalization: "on"` re-processes the string (numbers, etc.).
   * After we expand ordinals to words ("ninetieth"), that second pass can mis-read them
   * (e.g. "ninety-ninth"). Default: `off` when we pre-normalize; `auto` when sending raw text.
   * Override with `ELEVENLABS_APPLY_TEXT_NORMALIZATION=on|auto|off`.
   */
  const textNormRaw = process.env.ELEVENLABS_APPLY_TEXT_NORMALIZATION?.trim().toLowerCase();
  const applyTextNormalization: "auto" | "on" | "off" =
    textNormRaw === "on" || textNormRaw === "auto" || textNormRaw === "off"
      ? textNormRaw
      : skipSpoken
        ? "auto"
        : "off";

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model_id: modelId,
        text: spokenText,
        apply_text_normalization: applyTextNormalization,
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    return {
      ok: false,
      error: `Eleven Labs TTS failed (${res.status}): ${errBody.slice(0, 400)}`,
    };
  }

  const buffer = await res.arrayBuffer();
  return { ok: true, buffer };
}
