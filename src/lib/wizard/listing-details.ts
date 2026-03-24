export type ListingDetailsDisplay = {
  provider: string | null;
  source_url: string | null;
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  neighborhood_summary: string | null;
  features: unknown;
  warning: string | null;
};

export function listingSnapshotRowToDisplay(
  row: Record<string, unknown>,
  warning: string | null = null,
): ListingDetailsDisplay {
  const raw = row.raw as Record<string, unknown> | undefined;
  const ingestError =
    raw && typeof raw === "object" && "ingest_error" in raw
      ? String((raw as { ingest_error?: unknown }).ingest_error ?? "")
      : null;

  return {
    provider: typeof row.provider === "string" ? row.provider : null,
    source_url: typeof row.source_url === "string" ? row.source_url : null,
    address: typeof row.address === "string" ? row.address : null,
    price: typeof row.price === "number" ? row.price : null,
    beds: typeof row.beds === "number" ? row.beds : null,
    baths: typeof row.baths === "number" ? row.baths : null,
    sqft: typeof row.sqft === "number" ? row.sqft : null,
    year_built: typeof row.year_built === "number" ? row.year_built : null,
    neighborhood_summary:
      typeof row.neighborhood_summary === "string"
        ? row.neighborhood_summary
        : null,
    features: row.features ?? [],
    warning: warning ?? (ingestError || null),
  };
}
