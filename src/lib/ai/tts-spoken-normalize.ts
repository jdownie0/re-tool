/**
 * Pre-process listing/voiceover copy so TTS reads numbers naturally (sq ft, addresses, beds/baths).
 * Works with Eleven Labs `apply_text_normalization` for additional number handling.
 */

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

/** Integers 0 .. 999_999_999 — enough for sqft, prices, street numbers. */
export function integerToEnglishWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return "zero";
  if (n < 20) return ONES[n] ?? String(n);

  function under100(num: number): string {
    if (num < 20) return ONES[num]!;
    const t = Math.floor(num / 10);
    const o = num % 10;
    const ten = TENS[t];
    if (!ten) return ONES[num]!;
    return o ? `${ten}-${ONES[o]}` : ten;
  }

  function under1000(num: number): string {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    if (h === 0) return under100(rest);
    const head = `${ONES[h]} hundred`;
    if (rest === 0) return head;
    return `${head} ${under100(rest)}`;
  }

  if (n < 1000) return under1000(n);

  const parts: string[] = [];
  let remaining = Math.floor(n);

  const billion = Math.floor(remaining / 1_000_000_000);
  if (billion) {
    parts.push(`${under1000(billion)} billion`);
    remaining %= 1_000_000_000;
  }
  const million = Math.floor(remaining / 1_000_000);
  if (million) {
    parts.push(`${under1000(million)} million`);
    remaining %= 1_000_000;
  }
  const thousand = Math.floor(remaining / 1000);
  if (thousand) {
    parts.push(`${under1000(thousand)} thousand`);
    remaining %= 1000;
  }
  if (remaining > 0) {
    parts.push(under1000(remaining));
  }

  return parts.join(" ");
}

function parseDigits(s: string): number | null {
  const cleaned = s.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** e.g. "11510" → "one one five one zero" (typical for grid street numbers). */
function digitStringToSpokenDigits(d: string): string {
  return d
    .split("")
    .map((ch) => (/^\d$/.test(ch) ? ONES[Number(ch)]! : ch))
    .join(" ");
}

const ORDINAL_UNDER_20: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eighth",
  9: "ninth",
  10: "tenth",
  11: "eleventh",
  12: "twelfth",
  13: "thirteenth",
  14: "fourteenth",
  15: "fifteenth",
  16: "sixteenth",
  17: "seventeenth",
  18: "eighteenth",
  19: "nineteenth",
};

/**
 * Ordinals for grid street names. The spoken form matches the digits in the script:
 * 90th → "ninetieth", 99th → "ninety-ninth". If audio says the wrong ordinal, the script text has the wrong number.
 */
function ordinalToEnglishWords(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n > 999) {
    return `${integerToEnglishWords(Math.floor(n))}th`;
  }
  if (n < 20) {
    return ORDINAL_UNDER_20[n] ?? `${integerToEnglishWords(n)}th`;
  }
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    if (o === 0) {
      const tensOrd: Record<number, string> = {
        2: "twentieth",
        3: "thirtieth",
        4: "fortieth",
        5: "fiftieth",
        6: "sixtieth",
        7: "seventieth",
        8: "eightieth",
        9: "ninetieth",
      };
      return tensOrd[t] ?? `${integerToEnglishWords(n)}th`;
    }
    const onesOrd = ORDINAL_UNDER_20[o];
    if (!onesOrd) return `${integerToEnglishWords(n)}th`;
    return `${TENS[t]}-${onesOrd}`;
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return `${ONES[h]} hundredth`;
  return `${ONES[h]} hundred ${ordinalToEnglishWords(rest)}`;
}

function normalizeStreetType(raw: string): string {
  const x = raw.replace(/\.$/, "").toLowerCase();
  const map: Record<string, string> = {
    ave: "avenue",
    avenue: "avenue",
    st: "street",
    street: "street",
    rd: "road",
    road: "road",
    blvd: "boulevard",
    boulevard: "boulevard",
    way: "way",
    cir: "circle",
    circle: "circle",
    dr: "drive",
    drive: "drive",
    ln: "lane",
    lane: "lane",
    ct: "court",
    court: "court",
    pl: "place",
    place: "place",
    pkwy: "parkway",
    parkway: "parkway",
  };
  return map[x] ?? x;
}

function expandDirectionToken(dir: string): string {
  const k = dir.trim().toLowerCase();
  const map: Record<string, string> = {
    n: "north",
    s: "south",
    e: "east",
    w: "west",
    ne: "northeast",
    nw: "northwest",
    se: "southeast",
    sw: "southwest",
    north: "north",
    south: "south",
    east: "east",
    west: "west",
    northeast: "northeast",
    northwest: "northwest",
    southeast: "southeast",
    southwest: "southwest",
  };
  return map[k] ?? dir;
}

/**
 * Expand common real-estate numeric patterns to spoken English before TTS.
 */
export function normalizeSpokenTextForTts(input: string): string {
  let t = input;

  // Square footage
  t = t.replace(
    /\b(\d{1,3}(?:,\d{3})*|\d+)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|square\s+foot|SF)\b/gi,
    (match, numStr: string) => {
      const n = parseDigits(numStr);
      if (n === null) return match;
      return `${integerToEnglishWords(n)} square feet`;
    },
  );

  // Grid-style addresses: "11510 99th Avenue SW" → digit-by-digit + ordinal (ninety-ninth) + avenue + southwest
  t = t.replace(
    /\b(\d{1,6})\s+(\d{1,3})(st|nd|rd|th)\s+(Avenue|Ave\.?|Street|St\.?|Road|Rd\.?|Boulevard|Blvd\.?|Way|Circle|Cir\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Parkway|Pkwy)\s*(?:,)?\s*(N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)?\b/gi,
    (
      match,
      streetNum: string,
      ordNum: string,
      _ordSuffix: string,
      streetTypeRaw: string,
      dirRaw: string | undefined,
    ) => {
      const o = parseDigits(ordNum);
      if (o === null || o < 1 || o > 999) return match;
      if (!/^\d+$/.test(streetNum)) return match;
      const spokenDigits = digitStringToSpokenDigits(streetNum);
      const ordWords = ordinalToEnglishWords(o);
      const typeLower = normalizeStreetType(streetTypeRaw);
      const d = dirRaw?.trim();
      if (!d) {
        return `${spokenDigits} ${ordWords} ${typeLower}`;
      }
      return `${spokenDigits} ${ordWords} ${typeLower} ${expandDirectionToken(d)}`;
    },
  );

  // Half baths: 2.5 baths, 3.5 BA
  t = t.replace(/\b(\d+)\.5\s*(baths?|bath|BA)\b/gi, (_, whole: string) => {
    const w = Number(whole);
    if (!Number.isFinite(w)) return _;
    return `${integerToEnglishWords(w)} and a half baths`;
  });

  // Integer beds / bedrooms (before generic comma pass)
  t = t.replace(
    /\b(\d{1,2})\s*(bedrooms?|beds?|bed|BR|BD)\b/gi,
    (match, numStr: string, unit: string) => {
      const n = parseDigits(numStr);
      if (n === null || n > 24) return match;
      const w = integerToEnglishWords(n);
      const u = unit.toLowerCase();
      if (u === "br" || u === "bd") {
        return `${w} ${n === 1 ? "bedroom" : "bedrooms"}`;
      }
      if (u.startsWith("bedroom")) {
        return `${w} ${n === 1 ? "bedroom" : "bedrooms"}`;
      }
      return `${w} ${n === 1 ? "bed" : "beds"}`;
    },
  );

  // Integer baths
  t = t.replace(/\b(\d{1,2})\s*(baths?|bath)\b/gi, (match, numStr: string) => {
    const n = parseDigits(numStr);
    if (n === null || n > 24) return match;
    const w = integerToEnglishWords(n);
    return `${w} ${n === 1 ? "bath" : "baths"}`;
  });

  // Street number + name + suffix (common US forms)
  t = t.replace(
    /\b(\d{1,5})\s+(?:(North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3})\s+(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Boulevard|Blvd\.?|Way|Circle|Cir\.?|Place|Pl\.?|Parkway|Pkwy|Terrace|Ter\.?|Highway|Hwy\.?)\b/gi,
    (match, streetNum: string, dir: string | undefined, streetName: string, suffix: string) => {
      const n = parseDigits(streetNum);
      if (n === null || n > 99999) return match;
      const numWords = integerToEnglishWords(n);
      const d = dir ? `${dir.trim()} ` : "";
      return `${numWords} ${d}${streetName} ${suffix}`;
    },
  );

  // Dollar list prices (avoid decimals here)
  t = t.replace(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)\b/g, (match, numStr: string) => {
    const n = parseDigits(numStr);
    if (n === null) return match;
    return `${integerToEnglishWords(n)} dollars`;
  });

  // Remaining comma-formatted integers (lot size, etc.)
  t = t.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match) => {
    const n = parseDigits(match);
    if (n === null) return match;
    return integerToEnglishWords(n);
  });

  return t;
}
