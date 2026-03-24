/**
 * Supabase Storage enforces a per-object size cap (local: supabase/config.toml
 * `[storage] file_size_limit`; hosted: Dashboard → Project Settings → Storage).
 * Defaults here should match so we fail fast with a clear message instead of EPIPE mid-upload.
 */
export const DEFAULT_MAX_RENDER_UPLOAD_BYTES = 50 * 1024 * 1024;

export function getMaxRenderUploadBytes(): number {
  const raw = process.env.RETOOL_MAX_RENDER_UPLOAD_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_RENDER_UPLOAD_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RENDER_UPLOAD_BYTES;
}

export function formatBytesHuman(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(n / 1024))} KiB`;
}

/** Extra context when upload fails after the client thought the file was within limits. */
export function renderUploadErrorHint(detail: string): string {
  const d = detail.toLowerCase();
  if (
    d.includes("epipe") ||
    d.includes("econnreset") ||
    d.includes("socketerror") ||
    d.includes("other side closed")
  ) {
    return (
      " The remote end closed the connection while the upload was in progress—often the file exceeds " +
      "Supabase Storage’s per-object size limit (commonly 50 MiB), a proxy/gateway timeout, or a transient network blip. " +
      "Raise the global file size limit in Dashboard → Project Settings → Storage and set RETOOL_MAX_RENDER_UPLOAD_BYTES to match; " +
      "this app retries a few times and streams the file to reduce memory spikes."
    );
  }
  return "";
}
