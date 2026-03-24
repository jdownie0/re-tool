/**
 * Builds a single text block from `listing_snapshots` for LLM script generation.
 * Prefer Zillow-style `description` from Apify `raw` when present.
 */

export type ListingSnapshotRow = {
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  neighborhood_summary: string | null;
  features: unknown;
  raw: unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function firstStringFromRaw(
  raw: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!raw) return null;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function formatFeatures(features: unknown): string | null {
  if (Array.isArray(features)) {
    const strings = features.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0,
    );
    return strings.length ? strings.join("; ") : null;
  }
  return null;
}

function firstNumberInRecord(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function firstIntInRecord(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  const n = firstNumberInRecord(obj, keys);
  if (n === null) return null;
  return Math.round(n);
}

/**
 * Prefer DB columns; fall back to Zillow-style `raw` / `resoFacts` when Apify left them null.
 */
function resolveBedBathSqft(row: ListingSnapshotRow): {
  beds: number | null;
  baths: number | null;
  sqft: number | null;
} {
  const raw = asRecord(row.raw);
  const reso = raw ? asRecord(raw.resoFacts) : null;

  const beds =
    row.beds ??
    (raw ? firstIntInRecord(raw, ["bedrooms", "beds", "bedsCount"]) : null) ??
    (reso ? firstIntInRecord(reso, ["bedrooms", "beds"]) : null);

  const baths =
    row.baths ??
    (raw
      ? firstNumberInRecord(raw, ["bathrooms", "baths", "bathsFloat"])
      : null) ??
    (reso ? firstNumberInRecord(reso, ["bathrooms", "baths"]) : null);

  const sqft =
    row.sqft ??
    (raw
      ? firstIntInRecord(raw, [
          "livingArea",
          "livingAreaValue",
          "area",
          "sqft",
          "squareFeet",
        ])
      : null) ??
    (reso
      ? firstIntInRecord(reso, ["livingArea", "livingAreaValue", "sqft"])
      : null);

  return { beds, baths, sqft };
}

/**
 * Returns non-empty text for OpenAI, or null if there is nothing to work with.
 */
export function buildListingContextForScript(row: ListingSnapshotRow): string | null {
  const raw = asRecord(row.raw);
  const description = firstStringFromRaw(raw, [
    "description",
    "homeDescription",
    "listingDescription",
    "remarks",
  ]);

  const parts: string[] = [];

  if (description) {
    parts.push(`Listing description (from source):\n${description}`);
  }

  const { beds, baths, sqft } = resolveBedBathSqft(row);

  const facts: string[] = [];
  if (row.address) {
    facts.push(`Address: ${row.address}`);
  }
  if (row.price != null) facts.push(`Price: $${Number(row.price).toLocaleString()}`);
  if (beds != null) facts.push(`Bedrooms: ${beds}`);
  if (baths != null) facts.push(`Bathrooms: ${baths}`);
  if (sqft != null) facts.push(`Living area: ${sqft} sq ft`);
  if (row.year_built != null) facts.push(`Year built: ${row.year_built}`);
  if (facts.length) {
    parts.push(`Key facts:\n${facts.join("\n")}`);
  }

  if (row.address?.trim()) {
    parts.push(
      [
        "Address fidelity (for the voiceover):",
        "If the script mentions the property location or street, use the exact address string from Key facts above—same digits and ordinals (e.g. 90th Avenue vs 99th).",
        "Do not paraphrase or change numbers in the address; text-to-speech reads ordinals literally (90th → “ninetieth”, 99th → “ninety-ninth”).",
      ].join("\n"),
    );
  }

  const mention: string[] = [];
  if (beds != null) mention.push(`${beds} bedroom${beds === 1 ? "" : "s"}`);
  if (baths != null) mention.push(`${baths} bathroom${baths === 1 ? "" : "s"}`);
  if (sqft != null) mention.push(`${sqft.toLocaleString()} square feet of living space`);
  if (mention.length > 0) {
    parts.push(
      [
        "Voiceover requirements:",
        "The spoken script MUST clearly state every one of the following that appears in Key facts above: number of bedrooms, number of bathrooms, and total living square footage.",
        "Use natural wording (for example “three bedrooms,” “two and a half baths,” “just under 2,400 square feet”). Do not omit these facts when they are listed.",
        `This listing includes: ${mention.join("; ")}.`,
      ].join("\n"),
    );
  }

  if (row.neighborhood_summary?.trim()) {
    parts.push(`Neighborhood / area:\n${row.neighborhood_summary.trim()}`);
  }

  const featStr = formatFeatures(row.features);
  if (featStr) {
    parts.push(`Features & details:\n${featStr}`);
  }

  const text = parts.join("\n\n").trim();
  return text.length > 0 ? text : null;
}
