/**
 * Server-only: Apify Actor `maxcopell/zillow-detail-scraper` (REST id `maxcopell~zillow-detail-scraper`).
 * @see https://apify.com/maxcopell/zillow-detail-scraper
 */

const ACTOR_REST_ID = "maxcopell~zillow-detail-scraper";
const API_BASE = "https://api.apify.com/v2";

export type ListingSnapshotInsertFields = {
  source_url: string | null;
  provider: string;
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  neighborhood_summary: string | null;
  comps: unknown[];
  features: unknown[];
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function firstNumber(
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

function firstInt(obj: Record<string, unknown>, keys: string[]): number | null {
  const n = firstNumber(obj, keys);
  if (n === null) return null;
  return Math.round(n);
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function collectFeatures(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const reso = asRecord(item.resoFacts);
  const candidates = [
    reso?.cooling,
    reso?.heating,
    reso?.flooring,
    reso?.appliances,
    item.description,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) out.push(c.trim());
    else if (Array.isArray(c)) {
      for (const x of c) {
        if (typeof x === "string" && x.trim()) out.push(x.trim());
      }
    }
  }
  if (out.length === 0) {
    const feat = item.features;
    if (Array.isArray(feat)) {
      for (const x of feat) {
        if (typeof x === "string" && x.trim()) out.push(x.trim());
      }
    }
  }
  return out.slice(0, 20);
}

function collectComps(item: Record<string, unknown>): unknown[] {
  const c = item.comps ?? item.comparableHomes;
  if (Array.isArray(c)) return c;
  return [];
}

function mapDatasetItemToSnapshot(
  listingUrl: string,
  item: unknown,
): ListingSnapshotInsertFields {
  const row = asRecord(item) ?? {};
  const address =
    firstString(row, [
      "address",
      "streetAddress",
      "unformattedAddress",
      "fullAddress",
    ]) ?? null;

  const price = firstNumber(row, [
    "price",
    "unformattedPrice",
    "listPrice",
    "listingPrice",
  ]);

  const beds = firstInt(row, ["bedrooms", "beds", "bedsCount"]);
  const baths = firstNumber(row, ["bathrooms", "baths", "bathsFloat"]);
  const sqft = firstInt(row, [
    "livingArea",
    "livingAreaValue",
    "area",
    "sqft",
    "squareFeet",
  ]);
  const year_built = firstInt(row, ["yearBuilt", "year_built"]);

  const neighborhood_summary =
    firstString(row, [
      "neighborhoodSummary",
      "neighborhood",
      "cityRegion",
    ]) ?? null;

  const features = collectFeatures(row);
  const comps = collectComps(row);

  return {
    source_url: listingUrl,
    provider: "apify:maxcopell/zillow-detail-scraper",
    address,
    price,
    beds,
    baths,
    sqft,
    year_built,
    neighborhood_summary,
    comps,
    features,
    raw: row,
  };
}

/**
 * Runs the Actor synchronously and returns the first dataset item mapped for `listing_snapshots`.
 */
export async function runListingScrape(
  listingUrl: string,
): Promise<ListingSnapshotInsertFields> {
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Listing ingest is not configured (missing APIFY_API_TOKEN).");
  }

  const endpoint = `${API_BASE}/acts/${ACTOR_REST_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: [{ url: listingUrl }],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Apify listing scrape failed (${res.status}): ${text.slice(0, 800)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Apify returned invalid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "No listing data was returned for this URL. Check that it is a supported property page.",
    );
  }

  return mapDatasetItemToSnapshot(listingUrl, parsed[0]);
}
