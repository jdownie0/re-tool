import type { SupabaseClient } from "@supabase/supabase-js";
import { formatStorageClientError } from "@/lib/supabase/supabase-fetch";

const MAX_ATTEMPTS = 4;

type BucketApi = ReturnType<SupabaseClient["storage"]["from"]>;
type UploadBody = Parameters<BucketApi["upload"]>[1];

/** Transient network / TLS / gateway drops while uploading to Storage. */
export function isRetryableStorageUploadDetail(detail: string): boolean {
  const d = detail.toLowerCase();
  return (
    d.includes("fetch failed") ||
    d.includes("socketerror") ||
    d.includes("other side closed") ||
    d.includes("epipe") ||
    d.includes("econnreset") ||
    d.includes("etimedout") ||
    d.includes("econnaborted") ||
    d.includes("econnrefused")
  );
}

/**
 * Upload to `renders` with retries. Use `createBody()` to return a **fresh** stream per attempt
 * (e.g. `() => createReadStream(path)`); buffers can reuse the same buffer each time.
 */
export async function uploadToRendersWithRetry(
  supabase: SupabaseClient,
  objectPath: string,
  createBody: () => UploadBody,
  fileOptions: { contentType: string; upsert: boolean },
): Promise<{ error: { message: string; originalError?: unknown } | null }> {
  let lastError: { message: string; originalError?: unknown } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const ms = 1500 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, ms));
    }
    const { error } = await supabase.storage
      .from("renders")
      .upload(objectPath, createBody(), fileOptions);
    if (!error) return { error: null };
    lastError = error;
    const detail = formatStorageClientError(error);
    if (!isRetryableStorageUploadDetail(detail)) break;
  }
  return { error: lastError };
}
