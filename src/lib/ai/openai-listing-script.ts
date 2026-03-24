/**
 * Server-only: OpenAI Chat Completions for listing voiceover scripts.
 */

import { getOpenAiApiKey } from "@/lib/ai/openai-env";

const DEFAULT_MODEL = "gpt-4o-mini";

function getModel(): string {
  return process.env.OPENAI_SCRIPT_MODEL?.trim() || DEFAULT_MODEL;
}

export async function generateVoiceoverScriptFromListing(
  listingContext: string,
  options: {
    /** Target video length in seconds (guides word count). */
    durationSeconds: number;
    /** Optional project / listing title for tone. */
    projectTitle?: string | null;
  },
): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) {
    throw new Error(
      "OpenAI is not configured. Set OPEN_AI_SECRET (or OPENAI_API_KEY) on the server.",
    );
  }

  const { durationSeconds, projectTitle } = options;
  const approxWordsMin = Math.max(40, Math.floor(durationSeconds * 2));
  const approxWordsMax = Math.max(approxWordsMin + 20, Math.floor(durationSeconds * 3.5));

  const system = `You write concise, professional real estate voiceover scripts for listing videos. 
Output plain text only — no title line, no bullet points, no stage directions in brackets unless essential.
Match a spoken tone: warm, clear, and persuasive. Avoid hype words that sound fake.
The script will be read aloud over property photos; keep sentences easy to speak in one breath where possible.
Whenever the listing data includes bedroom count, bathroom count, and/or living area square footage, you must state each of those facts clearly in the script—do not omit them. Never invent numbers that are not in the listing.
Addresses and street names: if you mention the location or address, copy it exactly from the listing data—every digit and ordinal (e.g. 90th vs 99th, street numbers). Do not substitute, round, or “fix” numbers in addresses.`;

  const user = `Use ONLY the listing information below (from MLS / Zillow-style data). Do not invent facts not supported by the text.

${projectTitle ? `Property label: ${projectTitle}\n\n` : ""}Target spoken length: about ${approxWordsMin}–${approxWordsMax} words for roughly ${durationSeconds} seconds of video.

Listing data:
---
${listingContext}
---

Write the voiceover script now. If "Voiceover requirements" appear above, follow them exactly.
If Key facts include an address, any spoken address must match it verbatim (same numbers and ordinals—do not change 90th to 99th or similar).`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      max_tokens: 2500,
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    const msg = json.error?.message ?? res.statusText;
    throw new Error(`OpenAI request failed: ${msg}`);
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenAI returned an empty script.");
  }

  return text;
}
