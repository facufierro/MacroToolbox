export type ConsoleLevel = "info" | "warn" | "error";
export type DiagnosticEntry = { id: number; at: number; level: ConsoleLevel; source: string; message: string };

export type ConsoleEntry = {
  id: number;
  source: string;
  message: string;
  firstAt: number;
  lastAt: number;
  count: number;
  level: ConsoleLevel;
};

export type ConsoleState = { entries: ConsoleEntry[]; expanded: boolean; nextId: number };
export const EMPTY_CONSOLE: ConsoleState = { entries: [], expanded: false, nextId: 1 };
export type ConsoleAction =
  | { type: "error"; source: string; message: string; at: number }
  | { type: "log"; source: string; message: string; at: number; level: ConsoleLevel }
  | { type: "toggle" }
  | { type: "clear" };

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message || error.name;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? String(error); }
  catch { return String(error); }
}

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  if (action.type === "toggle") return { ...state, expanded: !state.expanded };
  if (action.type === "clear") return { ...state, entries: [] };
  const level = action.type === "error" ? "error" : action.level;
  const last = state.entries[state.entries.length - 1];
  // Repeated polling failures stay readable and do not reopen a collapsed console.
  if (last?.source === action.source && last.message === action.message && last.level === level) {
    return { ...state, entries: [...state.entries.slice(0, -1), { ...last, lastAt: action.at, count: last.count + 1 }] };
  }
  return { expanded: state.expanded || level === "error" || level === "warn", nextId: state.nextId + 1, entries: [...state.entries, {
    id: state.nextId, source: action.source, message: action.message, firstAt: action.at, lastAt: action.at, count: 1,
    level,
  }].sort((a, b) => a.firstAt - b.firstAt || a.id - b.id) };
}

export function consoleText(entries: ConsoleEntry[]): string {
  return entries.map(entry => `[${new Date(entry.firstAt).toISOString()}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.message}${entry.count > 1 ? ` (${entry.count} times; last ${new Date(entry.lastAt).toISOString()})` : ""}`).join("\n");
}

export function consoleTime(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function captureWindowErrors(target: Window, report: (error: unknown) => void): () => void {
  const onError = (event: ErrorEvent) => report(event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
