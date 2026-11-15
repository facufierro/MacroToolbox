import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { IconButton } from "./Icon";
import { findUpdate } from "./updates";

export function SettingsUpdate() {
  const reportError = useErrorReporter();
  const started = useRef(false);
  const running = useRef(false);
  const [status, setStatus] = useState("Checking for an update...");
  const [retry, setRetry] = useState(false);

  async function update() {
    if (running.current) return;
    running.current = true;
    setRetry(false);
    setStatus("Checking for an update...");
    try {
      const available = await findUpdate(await api.getAppVersion());
      if (!available) {
        setStatus("No newer release is available yet.");
        setRetry(true);
        return;
      }
      if (!available.downloadUrl) {
        setStatus(`Update ${available.version} has no installer available yet.`);
        setRetry(true);
        return;
      }
      setStatus(`Downloading and installing ${available.version}...`);
      await api.downloadAndInstallUpdate(available.downloadUrl);
    } catch (error) {
      reportError(error, "Automatic update failed");
      setStatus("Could not update. Check Console for details and try again.");
      setRetry(true);
    } finally { running.current = false; }
  }

  useEffect(() => {
    // Strict Mode replays mount effects; an installer must only launch once.
    if (started.current) return;
    started.current = true;
    void update();
  }, []);

  return <div className="loading">
    <div className="empty-state">
      <h2>Update required</h2>
      <p>Settings were saved by a newer MacroToolbox version.</p>
      <p role="status" aria-live="polite">{status}</p>
      {retry && <IconButton showLabel icon="rotate" label="Retry update" className="btn btn--primary" onClick={() => void update()} />}
    </div>
  </div>;
}
