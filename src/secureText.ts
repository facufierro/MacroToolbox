import type { SecureTextDraft } from "./types";
import type { Step } from "./behaviors";

export function secureTextIds(steps: Step[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    if (step.type === "securesend") ids.add(step.credentialId);
    else if (step.type === "sequence" || step.type === "parallel") for (const id of secureTextIds(step.steps)) ids.add(id);
  }
  return ids;
}

export const usedSecureTexts = (steps: Step[], drafts: SecureTextDraft[]): SecureTextDraft[] => {
  const ids = secureTextIds(steps);
  return drafts.filter(draft => ids.has(draft.credentialId));
};
