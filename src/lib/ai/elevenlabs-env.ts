/**
 * Server-only: Eleven Labs API key resolution.
 * Prefer `ELEVEN_LABS_KEY_ID`; fall back to common env names.
 * (Dashboard → Profile → API key; sent as `xi-api-key`.)
 */

export function getElevenLabsApiKey(): string {
  return (
    process.env.ELEVEN_LABS_KEY_ID?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_LABS_API_KEY?.trim() ||
    ""
  );
}

export function isElevenLabsConfigured(): boolean {
  return getElevenLabsApiKey().length > 0;
}
