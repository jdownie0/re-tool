/**
 * Server-only: OpenAI API key resolution.
 * Prefer `OPEN_AI_SECRET`; fall back to `OPENAI_API_KEY` for compatibility.
 */

export function getOpenAiApiKey(): string {
  return (
    process.env.OPEN_AI_SECRET?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

export function isOpenAiConfigured(): boolean {
  return getOpenAiApiKey().length > 0;
}
