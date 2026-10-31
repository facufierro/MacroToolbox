import type { SecureTextDraft } from "./types";

export function SecureSendInput({ credentialId, drafts, onChange }: {
  credentialId: string;
  drafts: SecureTextDraft[];
  onChange?: (credentialId: string, password: string) => void;
}) {
  const draft = drafts.find(draft => draft.credentialId === credentialId);
  return <input className="secure-send-input" type="password" aria-label="Password" autoComplete="new-password"
    spellCheck={false} autoCapitalize="off" value={draft?.password ?? ""}
    placeholder={credentialId && !draft ? "Saved password" : "Password"} disabled={!onChange}
    onChange={event => onChange?.(draft ? credentialId : crypto.randomUUID(), event.target.value)} />;
}
