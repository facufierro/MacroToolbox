import { IconButton } from "./Icon";
import { useEffect, useRef, useState } from "react";

function sideModifier(code: string): string | null {
  const map: Record<string, string> = {
    ControlLeft: "lctrl",
    ControlRight: "rctrl",
    ShiftLeft: "lshift",
    ShiftRight: "rshift",
    AltLeft: "lalt",
    AltRight: "ralt",
    MetaLeft: "lwin",
    MetaRight: "rwin",
  };
  return map[code] ?? null;
}

function bindingModifiers(
  e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
  activeSideModifiers: Set<string> = new Set(),
) {
  const mods: string[] = [];
  // AltGr (RAlt on non-US layouts) arrives as a synthetic LCtrl held together with
  // RAlt — drop that phantom Ctrl so AltGr combos record as plain ralt.
  const altGr = activeSideModifiers.has("ralt");
  const isHeld = (mod: string) => activeSideModifiers.has(mod) && !(altGr && mod === "lctrl");
  const addSideOrGeneric = (left: string, right: string, generic: string, active: boolean) => {
    const sides = [left, right].filter(isHeld);
    if (sides.length) mods.push(...sides);
    else if (active) mods.push(generic);
  };
  addSideOrGeneric("lctrl", "rctrl", "ctrl", e.ctrlKey && !altGr);
  addSideOrGeneric("lshift", "rshift", "shift", e.shiftKey);
  addSideOrGeneric("lalt", "ralt", "alt", e.altKey);
  addSideOrGeneric("lwin", "rwin", "win", e.metaKey);
  return mods;
}

function toAhkKey(e: KeyboardEvent, activeSideModifiers: Set<string>): string {
  const mods = bindingModifiers(e, activeSideModifiers);
  const keyMap: Record<string, string> = {
    " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    PageUp: "PgUp", PageDown: "PgDn", Enter: "Enter", Escape: "Esc", Tab: "Tab",
    Backspace: "Backspace", Delete: "Del", Insert: "Ins", Home: "Home", End: "End",
    PrintScreen: "PrintScreen", NumLock: "NumLock", CapsLock: "CapsLock",
  };
  // Unlike e.key, e.code retains the keypad position. Keep keypad operators named so they
  // do not collapse into the corresponding main-keyboard character.
  const keypadKeys: Record<string, string> = {
    NumpadDivide: "NumpadDiv",
    NumpadMultiply: "NumpadMult",
    NumpadSubtract: "NumpadSub",
    NumpadAdd: "NumpadAdd",
    NumpadEnter: "NumpadEnter",
  };
  let key = keypadKeys[e.code] ?? (/^Numpad[0-9]$/.test(e.code) ? e.code : e.key);
  if (key in keyMap) key = keyMap[key];
  else if (/^F\d+$/.test(key)) key = key.toLowerCase();
  else if (key.length === 1) {
    // Record the typed character when it has an AHK name, so the binding means the key
    // label the user sees — on QWERTZ pressing Z must record "z", not the US position
    // "y". The backend resolves it back through the active layout. Shift transforms
    // (Shift+5 → "%"), punctuation, and characters with no AHK name (Cyrillic "й")
    // fall back to the physical e.code position.
    if (/^[a-z0-9]$/i.test(key)) key = key.toLowerCase();
    else {
      const punctCodes: Record<string, string> = {
        Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
        BracketLeft: "[", BracketRight: "]", Backquote: "`", Minus: "-", Equal: "=",
      };
      const codeMatch = e.code.match(/^(Key|Digit)(.+)$/);
      key = codeMatch ? codeMatch[2].toLowerCase() : (punctCodes[e.code] ?? key.toLowerCase());
    }
  }
  return [...mods, key].join(" ");
}

function toAhkMouseButton(e: MouseEvent, activeSideModifiers: Set<string>): string {
  const buttonMap: Record<number, string> = {
    0: "LButton",
    1: "MButton",
    2: "RButton",
    3: "XButton1",
    4: "XButton2",
  };
  const button = buttonMap[e.button];
  if (!button) return "";
  return [...bindingModifiers(e, activeSideModifiers), button].join(" ");
}

export function useBindingRecorder(recording: boolean, onCapture: (value: string) => void, allowChord = false) {
  const onCaptureRef = useRef(onCapture);
  const activeSideModifiersRef = useRef<Set<string>>(new Set());
  onCaptureRef.current = onCapture;

  useEffect(() => {
    if (!recording) return;

    const heldInputs = new Map<string, string>();
    const chordInputs: string[] = [];
    const chordModifiers: string[] = [];
    const rememberModifiers = (mods: string[]) => {
      for (const mod of mods) {
        if (!chordModifiers.includes(mod)) chordModifiers.push(mod);
      }
    };
    const capture = (value: string) => {
      if (value) onCaptureRef.current(value);
    };
    const rememberInput = (id: string, value: string) => {
      if (heldInputs.has(id)) return;
      const parts = value.split(/\s+/);
      const key = parts.pop();
      if (!key) return;
      rememberModifiers(parts);
      heldInputs.set(id, key);
      chordInputs.push(key);
    };
    const releaseInput = (id: string) => {
      if (!heldInputs.delete(id) || heldInputs.size > 0 || chordInputs.length === 0) return;
      capture([...chordModifiers, ...chordInputs].join(" "));
    };
    const keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const sideMod = sideModifier(e.code);
      if (sideMod) {
        activeSideModifiersRef.current.add(sideMod);
        if (allowChord && !chordModifiers.includes(sideMod)) chordModifiers.push(sideMod);
        return;
      }
      const value = toAhkKey(e, activeSideModifiersRef.current);
      if (allowChord) rememberInput(`key:${e.code}`, value);
      else capture(value);
    };
    const keyUpHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const sideMod = sideModifier(e.code);
      if (sideMod) {
        activeSideModifiersRef.current.delete(sideMod);
        if (allowChord && chordInputs.length === 0 && activeSideModifiersRef.current.size === 0) {
          const modifiers = chordModifiers.includes("ralt")
            ? chordModifiers.filter(mod => mod !== "lctrl")
            : chordModifiers;
          capture(modifiers.join(" "));
        }
        return;
      }
      if (allowChord) releaseInput(`key:${e.code}`);
    };
    const mouseDownHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const value = toAhkMouseButton(e, activeSideModifiersRef.current);
      if (allowChord) rememberInput(`mouse:${e.button}`, value);
      else capture(value);
    };
    const mouseUpHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (allowChord) releaseInput(`mouse:${e.button}`);
    };
    const contextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("keyup", keyUpHandler, true);
    window.addEventListener("mousedown", mouseDownHandler, true);
    window.addEventListener("mouseup", mouseUpHandler, true);
    window.addEventListener("contextmenu", contextMenuHandler, true);
    return () => {
      activeSideModifiersRef.current.clear();
      window.removeEventListener("keydown", keyHandler, true);
      window.removeEventListener("keyup", keyUpHandler, true);
      window.removeEventListener("mousedown", mouseDownHandler, true);
      window.removeEventListener("mouseup", mouseUpHandler, true);
      window.removeEventListener("contextmenu", contextMenuHandler, true);
    };
  }, [recording, allowChord]);
}

export function KeyInput({ value, onChange, placeholder = "Key", allowChord = false }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowChord?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  useBindingRecorder(recording, key => {
    onChange(key);
    setRecording(false);
  }, allowChord);

  return recording ? (
    <div className="key-recording">
      {allowChord ? "Hold the key/button combination, then release…" : "Press any key or mouse button…"}
    </div>
  ) : (
    <div className="input-row" style={{ margin: 0, flex: 1 }}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      <IconButton showLabel icon="keyboard" label="Record key" className="btn btn--ghost btn--sm" onClick={() => setRecording(true)} />
    </div>
  );
}

