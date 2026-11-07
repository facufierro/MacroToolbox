import { useState } from "react";
import { IconButton } from "./Icon";
import { useErrorReporter } from "./AppConsole";
import { CompactNumber } from "./CompactNumber";
import { api } from "./api";

export function CoordinatePicker({ gameExe, onPick }: { gameExe: string; onPick: (x: string, y: string) => void }) {
  const reportError = useErrorReporter();
  const [picking, setPicking] = useState(false);
  async function pick() {
    setPicking(true);
    try {
      const [x, y] = await api.pickCoordinate(gameExe);
      onPick(String(x), String(y));
    } catch (error) { reportError(error); }
    finally { setPicking(false); }
  }
  return <IconButton showLabel={picking} icon={picking ? "spinner" : "crosshairs"} label={picking ? "Click in app" : "Pick position"}
    spin={picking} className="btn btn--ghost btn--sm coordinate-picker" onClick={pick} disabled={picking} />;
}

export function GotoInput({ x, y, gameExe, onChange }: { x: string; y: string; gameExe: string; onChange: (x: string, y: string) => void }) {
  return <div className="goto-input">
    <CompactNumber label="X (%)" prefix="X" unit="%" min={0} max={100} step={0.1} value={x} onChange={value => onChange(value, y)} />
    <CompactNumber label="Y (%)" prefix="Y" unit="%" min={0} max={100} step={0.1} value={y} onChange={value => onChange(x, value)} />
    <CoordinatePicker gameExe={gameExe} onPick={onChange} />
  </div>;
}
