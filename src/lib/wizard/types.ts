export const WIZARD_STEPS = [
  "photos",
  "voiceover",
  "arrange",
  "music",
  "review",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export function isWizardStep(s: string): s is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(s);
}

export type WizardMetadata = {
  version: 1;
  captionsEnabled: boolean;
  scriptDraft: string;
  /** Mock: script job completed at least once */
  scriptMockReady?: boolean;
  voicePreset: string;
  voiceMockReady: boolean;
  voiceDurationMs?: number;
  musicPreset: string | null;
  musicPrompt: string;
  musicSkipped: boolean;
  musicMockReady: boolean;
  /** Target length used for Eleven Labs compose / mock (ms). */
  musicDurationMs?: number;
};

export function defaultWizardMetadata(): WizardMetadata {
  return {
    version: 1,
    captionsEnabled: true,
    scriptDraft: "",
    voicePreset: "hope-female",
    voiceMockReady: false,
    musicPreset: null,
    musicPrompt: "",
    musicSkipped: false,
    musicMockReady: false,
  };
}
