/**
 * Server-only: list voices available to the Eleven Labs account (premade + custom).
 * https://elevenlabs.io/docs/api-reference/voices/get-all
 */

import { getElevenLabsApiKey } from "@/lib/ai/elevenlabs-env";

/** One row for the voiceover wizard (table + API list). */
export type WizardVoiceOption = {
  id: string;
  name: string;
  category?: string;
  /** Single-line label (name — category) for compact display. */
  label: string;
};

type VoicesApiVoice = {
  voice_id?: string;
  name?: string;
  category?: string;
};

export async function fetchElevenLabsVoices(): Promise<
  { ok: true; voices: WizardVoiceOption[] } | { ok: false; error: string }
> {
  const key = getElevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Eleven Labs API key not configured" };
  }

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      error: `Eleven Labs voices request failed (${res.status}): ${text.slice(0, 240)}`,
    };
  }

  const data = (await res.json()) as { voices?: VoicesApiVoice[] };
  const raw = data.voices ?? [];
  const voices: WizardVoiceOption[] = raw
    .filter((v): v is VoicesApiVoice & { voice_id: string; name: string } =>
      Boolean(v.voice_id && v.name),
    )
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      label: v.category ? `${v.name} — ${v.category}` : v.name,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  if (voices.length === 0) {
    return { ok: false, error: "Eleven Labs returned no voices for this account." };
  }

  return { ok: true, voices };
}
