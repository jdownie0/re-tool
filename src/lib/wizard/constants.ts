/** Video length options: seconds → minimum photos (Calico-style). */
export const DURATION_OPTIONS = [
  { seconds: 20, label: "20s", photos: 5 },
  { seconds: 40, label: "40s", photos: 10 },
  { seconds: 60, label: "60s", photos: 15 },
] as const;

/** When `projects.duration_seconds` is null, treat as 60s (15 photos max tier). */
export const DEFAULT_WIZARD_DURATION_SECONDS = 60;

export function requiredPhotosForDuration(seconds: number | null): number {
  const opt = DURATION_OPTIONS.find((o) => o.seconds === seconds);
  return opt?.photos ?? 5;
}

/** Seconds per scene slot for time labels (4s per photo in reference UI). */
export const SECONDS_PER_SCENE = 4;

export const VOICE_PRESETS = [
  { id: "hope-female", label: "Hope — Female" },
  { id: "james-male", label: "James — Male" },
] as const;

export const MUSIC_PRESETS = [
  {
    id: "warm",
    title: "Warm & Inviting",
    subtitle: "Acoustic guitar, soft piano",
  },
  {
    id: "modern",
    title: "Modern & Clean",
    subtitle: "Polished, contemporary feel",
  },
  {
    id: "cinematic",
    title: "Cinematic",
    subtitle: "Orchestral, aspirational",
  },
  {
    id: "laidback",
    title: "Laid Back",
    subtitle: "Mellow, relaxed groove",
  },
] as const;
