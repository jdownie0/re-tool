import type { WizardMetadata } from "@/lib/wizard/types";
import { defaultWizardMetadata } from "@/lib/wizard/types";

type ProjectMetadata = Record<string, unknown>;

export function getWizardFromMetadata(
  metadata: ProjectMetadata | null | undefined,
): WizardMetadata {
  const raw = metadata?.wizard;
  if (!raw || typeof raw !== "object") {
    return defaultWizardMetadata();
  }
  const w = raw as Partial<WizardMetadata>;
  const base = defaultWizardMetadata();
  return {
    ...base,
    ...w,
    version: 1,
  };
}

export function mergeWizardMetadata(
  metadata: ProjectMetadata | null | undefined,
  patch: Partial<WizardMetadata>,
): ProjectMetadata {
  const current = getWizardFromMetadata(metadata);
  return {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    wizard: {
      ...current,
      ...patch,
      version: 1,
    },
  };
}
