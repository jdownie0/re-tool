/**
 * Custom fetch for server-side Supabase clients: long timeouts and clearer errors.
 * Large Storage uploads and downloads can exceed default implicit limits.
 */

const DEFAULT_TIMEOUT_MS = 600_000;

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const c = new AbortController();
  const abort = () => c.abort();
  a.addEventListener("abort", abort);
  b.addEventListener("abort", abort);
  if (a.aborted || b.aborted) c.abort();
  return c.signal;
}

/**
 * Returns a `fetch` compatible with `createClient(..., { global: { fetch } })`.
 * Adds a generous per-request timeout (large Storage uploads). Does not wrap
 * thrown errors so Node/undici `cause` chains (TLS, DNS, etc.) stay intact.
 * @param timeoutMs - Per-request ceiling (default 10 minutes).
 */
export function createSupabaseFetch(timeoutMs: number = DEFAULT_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      init?.signal != null
        ? mergeAbortSignals(init.signal, timeoutSignal)
        : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}

export function getSupabaseHttpTimeoutMs(): number {
  const raw = process.env.SUPABASE_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** Unwraps @supabase/storage-js `StorageUnknownError.originalError` for job logs. */
export function formatStorageClientError(err: {
  message: string;
  originalError?: unknown;
}): string {
  let s = err.message;
  if (err.originalError != null) {
    const o = err.originalError;
    if (o instanceof Error) {
      s += o.cause != null ? ` (${o.message}; cause: ${String(o.cause)})` : ` (${o.message})`;
    } else {
      s += ` (${String(o)})`;
    }
  }
  return s;
}
