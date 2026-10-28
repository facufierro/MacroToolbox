import { Icon, IconButton } from "./Icon";
import { Component, createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { captureWindowErrors, consoleReducer, consoleText, EMPTY_CONSOLE, errorMessage } from "./consoleLog";
import type { CloudStatus } from "./types";
import "./console.css";

type ReportError = (error: unknown, source: string) => void;
const ErrorReporter = createContext<ReportError | null>(null);

class ConsoleBoundary extends Component<{ children: ReactNode; report: ReportError }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.report(error, "App"); }
  render() {
    return this.state.failed
      ? <div className="loading"><IconButton icon="rotate" label="Reload" className="btn btn--ghost" onClick={() => window.location.reload()} /></div>
      : this.props.children;
  }
}

export function useErrorReporter(source = "App") {
  const report = useContext(ErrorReporter);
  if (!report) throw new Error("Error reporting requires AppConsole.");
  return useCallback((error: unknown) => report(error, source), [report, source]);
}

export function AppConsole({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(consoleReducer, EMPTY_CONSOLE);
  const output = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  const report = useCallback<ReportError>((error, source) => {
    dispatch({ type: "error", message: errorMessage(error), source, at: Date.now() });
  }, []);

  useEffect(() => {
    const stopCapturing = captureWindowErrors(window, error => report(error, "App"));
    let disposed = false;
    const removers: Array<() => void> = [];
    const subscribe = async <T,>(name: string, receive: (value: T) => void) => {
      try {
        const remove = await listen<T>(name, event => receive(event.payload));
        if (disposed) remove(); else removers.push(remove);
      } catch (error) { if (!disposed) report(error, "Console"); }
    };
    void subscribe<string>("runtime-error", message => report(message, "Runtime"));
    void subscribe<string>("console-error", message => report(message, "Overlay"));
    void subscribe<CloudStatus>("firebase-status", status => {
      if (status.phase === "error") report(status.message, "Cloud");
    });
    return () => { disposed = true; stopCapturing(); removers.forEach(remove => remove()); };
  }, [report]);

  useEffect(() => {
    if (state.expanded && follow.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [state.entries, state.expanded]);

  return <ErrorReporter.Provider value={report}>
    <div className="app-shell">
      <div className="app-shell__content"><ConsoleBoundary report={report}>{children}</ConsoleBoundary></div>
      <section className="app-console" aria-label="Console">
        <div className="app-console__header">
          <button className="app-console__toggle" aria-expanded={state.expanded} aria-controls="console-output"
            onClick={() => { follow.current = true; dispatch({ type: "toggle" }); }}>
            <Icon name={state.expanded ? "chevron-down" : "chevron-right"} /> Console
            {state.entries.length > 0 && <span className="app-console__count">{state.entries.reduce((total, entry) => total + entry.count, 0)}</span>}
          </button>
          {state.expanded && <>
            <IconButton icon="copy" label="Copy" className="btn btn--ghost btn--sm" disabled={!state.entries.length} onClick={() => { void navigator.clipboard.writeText(consoleText(state.entries)).catch(error => report(error, "Console")); }} />
            <IconButton icon="ban" label="Clear" className="btn btn--ghost btn--sm" disabled={!state.entries.length} onClick={() => dispatch({ type: "clear" })} />
          </>}
        </div>
        {state.expanded && <ol id="console-output" className="app-console__output" role="log" aria-live="polite" ref={output}
          onScroll={event => { const el = event.currentTarget; follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 1; }}>
          {state.entries.map(entry => <li key={entry.id} className="app-console__entry">
            <time dateTime={new Date(entry.lastAt).toISOString()}>{new Date(entry.lastAt).toLocaleTimeString()}</time>
            <span className="app-console__source">{entry.source}</span>
            <pre>{entry.message}{entry.count > 1 && <span className="app-console__repeat"> ×{entry.count}</span>}</pre>
          </li>)}
          {!state.entries.length && <li className="app-console__empty">No messages</li>}
        </ol>}
      </section>
    </div>
  </ErrorReporter.Provider>;
}
