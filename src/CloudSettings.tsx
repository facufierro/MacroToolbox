import { IconButton } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import type { CloudStatus } from "./types";
import rules from "../firebase/firestore.rules?raw";

export function CloudSettings() {
  const reportError = useErrorReporter("Cloud");
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [setup, setSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const subscription = listen<CloudStatus>("firebase-status", e => { if (active) setStatus(e.payload); });
    subscription.then(() => api.cloudStatus()).then(s => { if (active) setStatus(s); }).catch(e => { if (active) reportError(e); });
    return () => { active = false; void subscription.then(unlisten => unlisten()).catch(reportError); };
  }, [reportError]);
  async function run(action: () => Promise<CloudStatus>) {
    setBusy(true);
    try { setStatus(await action()); } catch (e) { reportError(e); }
    finally { setBusy(false); }
  }
  async function configure() {
    const path = await open({ title: "Google Desktop OAuth JSON or saved Firebase connection", filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
    if (typeof path !== "string") return;
    await run(async () => {
      const result = await api.cloudConfigure(apiKey, await api.readTextFile(path));
      setSetup(false); setApiKey("");
      return result;
    });
  }
  async function exportConnection() {
    try {
      const path = await save({ defaultPath: "MacroToolbox-Firebase.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) await api.writeTextFile(path, await api.cloudExportConfig());
    } catch (e) { reportError(e); }
  }
  async function choose(choice: "local" | "cloud") {
    const revision = status?.revision ?? null;
    const confirmed = await ask(choice === "cloud"
      ? "Replace this computer's settings, profiles, folders and linked scripts with the cloud copy? Open editors will close and unsaved edits will be discarded. A local recovery copy will be saved first."
      : "Replace the cloud backup with this computer's complete setup? Other computers will need to review this change.", { title: "Choose your setup", kind: "warning" });
    if (confirmed) await run(() => api.cloudSync(choice, revision));
  }
  const working = busy || status?.phase === "syncing" || status?.phase === "signing_in";
  return <section className="cloud-settings">
    <h3>Account &amp; cloud backup</h3>
    <p>Save your settings, folders, profiles, images and linked scripts automatically. Sign in with the same Google account to restore them.</p>
    {status?.account && <strong>{status.account}</strong>}
    <p role="status">{status?.configured ? status.message : "Connect Firebase once to enable cloud backup."}</p>
    {status?.savedAt && <small>Last cloud save: {new Date(status.savedAt * 1000).toLocaleString()}</small>}
    {status?.configured && <div className="cloud-settings__actions">
      {(!status.account || status.phase === "error") && <IconButton showLabel icon="right-to-bracket" label="Sign in with Google" className="btn btn--primary" disabled={working} onClick={() => void run(api.cloudLogin)} />}
      {status.phase === "signing_in" && <IconButton showLabel icon="arrow-left" label="Cancel sign-in" className="btn btn--secondary" onClick={() => void api.cloudCancelLogin().catch(e => reportError(e))} />}
      {status.account && <>
        <IconButton showLabel icon="rotate" label="Sync now" className="btn btn--primary" disabled={working} onClick={() => void run(() => api.cloudSync())} />
        <IconButton showLabel icon="right-from-bracket" label="Sign out" className="btn btn--ghost" disabled={working} onClick={() => void run(api.cloudLogout)} />
      </>}
      {!status.account && <IconButton showLabel icon="gear" label="Connection settings" className="btn btn--ghost" disabled={working} onClick={() => setSetup(!setup)} />}
      <IconButton showLabel icon="floppy-disk" label="Save connection file" className="btn btn--ghost" disabled={working} onClick={() => void exportConnection()} />
    </div>}
    {status?.phase === "choice" && <div className="cloud-settings__actions">
      <IconButton showLabel icon="cloud-arrow-down" label="Restore cloud copy" className="btn btn--primary" disabled={working || !status.revision} onClick={() => void choose("cloud")} />
      <IconButton showLabel icon="desktop" label="Keep this computer" className="btn btn--ghost" disabled={working} onClick={() => void choose("local")} />
    </div>}
    {status && (!status.configured || setup) && <div className="cloud-settings__setup">
      <p>One-time project setup</p>
      <ol>
        <li>Create a Firebase project on the free Spark plan and enable Google under Authentication.</li>
        <li>Create a Standard Firestore database in production mode. Paste the supplied access rules into its Rules tab and publish them.</li>
        <li>In the same project's Google Auth Platform, create a Desktop app client and download its JSON.</li>
      </ol>
      <div className="cloud-settings__actions">
        <IconButton showLabel icon="arrow-up-right-from-square" label="Open Firebase" className="btn btn--ghost" onClick={() => void openUrl("https://console.firebase.google.com/").catch(e => reportError(e))} />
        <IconButton showLabel icon="desktop" label="Google desktop client" className="btn btn--ghost" onClick={() => void openUrl(`https://console.cloud.google.com/auth/clients${status.projectId ? `?project=${encodeURIComponent(status.projectId)}` : ""}`).catch(e => reportError(e))} />
        <IconButton showLabel icon={copied ? "check" : "copy"} label={copied ? "Rules copied" : "Copy access rules"}  className="btn btn--ghost" onClick={() => void navigator.clipboard.writeText(rules).then(() => setCopied(true)).catch(e => reportError(e))} />
      </div>
      <label>Firebase Web API key (Project settings → General)
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste Web API key" />
      </label>
      <IconButton showLabel icon="file-import" label="Import JSON & connect" className="btn btn--primary" disabled={working} onClick={() => void configure().catch(e => reportError(e))} />
      <small>A saved MacroToolbox connection file also works here, without entering an API key.</small>
    </div>}
    <small>Changes are checked every 30 seconds while MacroToolbox is running. Offline changes stay on this computer. Installed programs and extra script dependencies must be reinstalled separately.</small>
  </section>;
}
