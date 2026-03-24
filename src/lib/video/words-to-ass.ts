/**
 * Build a minimal ASS subtitle file from word-level timings (seconds).
 */

import type { AlignedWord } from "@/lib/ai/elevenlabs-forced-alignment";

function secondsToAssTime(t: number): string {
  const sec = Math.max(0, t);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.min(99, Math.round((sec - Math.floor(sec)) * 100));
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Escape user text for ASS Dialogue line (avoid breaking override tags). */
function escapeAssText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

/** Smaller font allows more characters per line without huge blocks. */
const MAX_CHARS_PER_LINE = 52;

/**
 * ASS `Fontsize` is in PlayRes units (see Script Info). `MarginV` is the gap from the bottom
 * edge for bottom-aligned lines (doubled from 48 → 96).
 */
const CAPTION_FONT_SIZE = Math.round(36 * 1.3);
const CAPTION_MARGIN_V = 96;

/**
 * Group words into dialogue lines, then emit ASS with bottom-centered captions.
 */
export function wordsToAss(words: AlignedWord[]): string {
  const lines: { start: number; end: number; text: string }[] = [];
  let buf: AlignedWord[] = [];
  let charCount = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const start = buf[0]!.start;
    const end = buf[buf.length - 1]!.end;
    const text = buf.map((w) => w.text).join(" ");
    lines.push({ start, end, text });
    buf = [];
    charCount = 0;
  };

  for (const w of words) {
    const piece = w.text.trim();
    if (!piece) continue;
    const addLen = (buf.length > 0 ? 1 : 0) + piece.length;
    if (charCount + addLen > MAX_CHARS_PER_LINE && buf.length > 0) {
      flush();
    }
    buf.push(w);
    charCount += addLen;
  }
  flush();

  const header = `[Script Info]
Title: captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${CAPTION_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,24,24,${CAPTION_MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = lines
    .map((ln) => {
      const st = secondsToAssTime(ln.start);
      const en = secondsToAssTime(Math.max(ln.end, ln.start + 0.1));
      const t = escapeAssText(ln.text);
      return (
        `Dialogue: 0,${st},${en},Default,,0,0,0,,` +
        `{\\an2\\fs${CAPTION_FONT_SIZE}}${t}`
      );
    })
    .join("\n");

  return `${header}${events}\n`;
}
