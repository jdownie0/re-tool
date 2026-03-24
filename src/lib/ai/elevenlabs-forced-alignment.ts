/**
 * ElevenLabs Forced Alignment — align transcript text to existing audio.
 * https://elevenlabs.io/docs/api-reference/forced-alignment/create
 */

import { getElevenLabsApiKey } from "@/lib/ai/elevenlabs-env";

export type AlignedWord = {
  text: string;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  loss?: number;
};

export async function alignAudioToText(
  audioBuffer: Buffer,
  text: string,
): Promise<
  { ok: true; words: AlignedWord[] } | { ok: false; error: string }
> {
  const key = getElevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Eleven Labs API key not configured" };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "Alignment text is empty." };
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" }),
    "voice.mp3",
  );
  form.append("text", trimmed);

  const ALIGN_TIMEOUT_MS = 300_000;
  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
      method: "POST",
      headers: {
        "xi-api-key": key,
      },
      body: form,
      signal: AbortSignal.timeout(ALIGN_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const extra =
      e instanceof Error && e.name === "TimeoutError"
        ? ` (request exceeded ${ALIGN_TIMEOUT_MS / 1000}s)`
        : "";
    return {
      ok: false,
      error: `Could not reach ElevenLabs forced alignment: ${msg}${extra}. ` +
        "Check network, VPN, firewall, and that https://api.elevenlabs.io is reachable from your server.",
    };
  }

  if (!res.ok) {
    const errBody = await res.text();
    const detail = errBody.slice(0, 800);
    try {
      const parsed = JSON.parse(errBody) as {
        detail?: { status?: string; message?: string };
      };
      const d = parsed?.detail;
      if (d?.status === "missing_permissions") {
        return {
          ok: false,
          error:
            "ElevenLabs API key is missing the forced_alignment permission. In the ElevenLabs dashboard → " +
            "Developers / API keys, edit your key (or create a new one) and enable **Forced Alignment** " +
            "for this key, then update ELEVEN_LABS_KEY_ID in your env. " +
            `Original: ${d.message ?? errBody}`,
        };
      }
    } catch {
      /* not JSON */
    }
    return {
      ok: false,
      error: `Forced alignment failed (${res.status}): ${detail}`,
    };
  }

  let json: {
    words?: Array<{
      text?: string;
      start?: number;
      end?: number;
      loss?: number;
    }>;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return {
      ok: false,
      error: "Forced alignment returned invalid JSON (empty or non-JSON body).",
    };
  }

  const raw = json.words ?? [];
  const words: AlignedWord[] = [];
  for (const w of raw) {
    if (
      typeof w.text === "string" &&
      typeof w.start === "number" &&
      typeof w.end === "number"
    ) {
      words.push({
        text: w.text,
        start: w.start,
        end: w.end,
        loss: typeof w.loss === "number" ? w.loss : undefined,
      });
    }
  }

  if (words.length === 0) {
    return {
      ok: false,
      error: "Forced alignment returned no words. Check that the script matches the voiceover.",
    };
  }

  return { ok: true, words };
}
