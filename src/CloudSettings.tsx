import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import type { CloudStatus } from "./types";
import rules from "../firebase/firestore.rules?raw";

export function CloudSettings() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [setup, setSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    const subscription = listen<CloudStatus>("firebase-status", e => { if (active) setStatus(e.payload); });
    subscription.then(() => api.cloudStatus()).then(s => { if (active) setStatus(s); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; void subscription.then(unlisten => unlisten()); };
  }, []);
  async function run(action: () => Promise<CloudStatus>) {
    setBusy(true); setError("");
    try { setStatus(await action()); } catch (e) { setError(String(e)); }
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
    } catch (e) { setError(String(e)); }
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
    {error && <p role="alert" className="cloud-settings__error">{error}</p>}
    {status?.configured && <div className="cloud-settings__actions">
      {(!status.account || status.phase === "error") && <button className="btn btn--primary" disabled={working} onClick={() => void run(api.cloudLogin)}>Sign in with Google</button>}
      {status.phase === "signing_in" && <button className="btn btn--ghost" onClick={() => void api.cloudCancelLogin().catch(e => setError(String(e)))}>Cancel sign-in</button>}
      {status.account && <>
        <button className="btn btn--primary" disabled={working} onClick={() => void run(() => api.cloudSync())}>Sync now</button>
        <button className="btn btn--ghost" disabled={working} onClick={() => void run(api.cloudLogout)}>Sign out</button>
      </>}
      {!status.account && <button className="btn btn--ghost" disabled={working} onClick={() => setSetup(!setup)}>Connection settings</button>}
      <button className="btn btn--ghost" disabled={working} onClick={() => void exportConnection()}>Save connection file</button>
    </div>}
    {status?.phase === "choice" && <div className="cloud-settings__actions">
      <button className="btn btn--primary" disabled={working || !status.revision} onClick={() => void choose("cloud")}>Restore cloud copy</button>
      <button className="btn btn--ghost" disabled={working} onClick={() => void choose("local")}>Keep this computer</button>
    </div>}
    {status && (!status.configured || setup) && <div className="cloud-settings__setup">
      <p>One-time project setup</p>
      <ol>
        <li>Create a Firebase project on the free Spark plan and enable Google under Authentication.</li>
        <li>Create a Standard Firestore database in production mode. Paste the supplied access rules into its Rules tab and publish them.</li>
        <li>In the same project's Google Auth Platform, create a Desktop app client and download its JSON.</li>
      </ol>
      <div className="cloud-settings__actions">
        <button className="btn btn--ghost" onClick={() => void openUrl("https://console.firebase.google.com/").catch(e => setError(String(e)))}>Open Firebase</button>
        <button className="btn btn--ghost" onClick={() => void openUrl(`https://console.cloud.google.com/auth/clients${status.projectId ? `?project=${encodeURIComponent(status.projectId)}` : ""}`).catch(e => setError(String(e)))}>Google desktop client</button>
        <button className="btn btn--ghost" onClick={() => void navigator.clipboard.writeText(rules).then(() => setCopied(true)).catch(e => setError(String(e)))}>{copied ? "Rules copied" : "Copy access rules"}</button>
      </div>
      <label>Firebase Web API key (Project settings → General)
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste Web API key" />
      </label>
      <button className="btn btn--primary" disabled={working} onClick={() => void configure().catch(e => setError(String(e)))}>Import JSON &amp; connect</button>
      <small>A saved MacroToolbox connection file also works here, without entering an API key.</small>
    </div>}
    <small>Changes are checked every 30 seconds while MacroToolbox is running. Offline changes stay on this computer. Installed programs and extra script dependencies must be reinstalled separately.</small>
  </section>;
}
