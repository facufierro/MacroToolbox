import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { Icon, IconButton } from "./Icon";
import { CompactNumber } from "./CompactNumber";
import { GotoInput } from "./GotoInput";
import type { OverlayGroup, OverlayItem, ProfileState } from "./types";

function OverlayColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="color-input compact-color" role="group" aria-label={`${label} controls`} title={label}>
    <input aria-label={`Choose ${label.toLowerCase()}`} title={label} className="color-input__swatch" type="color" value={value} onChange={event => onChange(event.target.value)} />
    <input aria-label={label} title={label} value={value} onChange={event => onChange(event.target.value)} placeholder="#RRGGBB" />
  </div>;
}

export function OverlayItemEditor({ initial, gameExe, states, groups, timers, saving, embedded = false, onSave, onClose }: {
  initial: OverlayItem;
  gameExe: string;
  states: ProfileState[];
  groups: OverlayGroup[];
  timers: OverlayItem[];
  saving: boolean;
  embedded?: boolean;
  onSave: (item: OverlayItem) => Promise<void>;
  onClose: () => void;
}) {
  const reportError = useErrorReporter();
  const [x, setX] = useState(String(initial.x));
  const [y, setY] = useState(String(initial.y));
  const [stateId, setStateId] = useState(initial.state_id ?? "");
  const [groupId, setGroupId] = useState(initial.group_id ?? "");
  const [visibleTimerId, setVisibleTimerId] = useState(initial.visible_while_timer_id ?? "");

  const [mins, setMins]         = useState(String(initial.type === "timer" ? Math.floor(initial.duration_ms / 60000) : 1));
  const [secs, setSecs]         = useState(String(initial.type === "timer" ? Math.floor((initial.duration_ms % 60000) / 1000) : 0));
  const [timerColor, setTimerColor] = useState(initial.type === "timer" ? initial.color : "#ffffff");
  const [timerFontSize, setTimerFontSize] = useState(String(initial.type === "timer" ? initial.font_size : 22));
  const [timerBackground, setTimerBackground] = useState(initial.type !== "timer" || initial.show_background !== false);
  const [timerStateId, setTimerStateId] = useState(initial.type === "timer" ? (initial.timer_state_id ?? "") : "");
  const [startWithOverlay, setStartWithOverlay] = useState(initial.type === "timer" && !!initial.start_with_overlay);
  const [showOnlyRunning, setShowOnlyRunning] = useState(initial.type === "timer" && !!initial.show_only_running);

  const [iw, setIw]             = useState(String(initial.type === "icon" ? initial.w : 64));
  const [ih, setIh]             = useState(String(initial.type === "icon" ? initial.h : 64));
  const [src, setSrc]           = useState<string | null>(initial.type === "icon" ? initial.src : null);

  const [bw, setBw]             = useState(String(initial.type === "bar" ? initial.w : 200));
  const [bh, setBh]             = useState(String(initial.type === "bar" ? initial.h : 20));
  const [barColor, setBarColor] = useState(initial.type === "bar" ? initial.color : "#4ade80");
  const [maxVal, setMaxVal]     = useState(String(initial.type === "bar" ? initial.max_value : 100));

  const [fontSize, setFontSize] = useState(String(initial.type === "text" ? initial.font_size : 16));
  const [txtColor, setTxtColor] = useState(initial.type === "text" ? initial.color : "#ffffff");
  const [content, setContent]   = useState(initial.type === "text" ? initial.content : "");

  async function browseIcon() {
    const selected = await openDialog({ title: "Select Icon", filters: [{ name: "Image", extensions: ["png","jpg","jpeg","webp","gif","ico"] }], multiple: false, directory: false });
    if (!selected) return;
    try { setSrc(await api.readImageAsDataUrl(selected as string)); } catch (e) { reportError(e); }
  }

  function build(): OverlayItem {
    const base = {
      id: initial.id,
      name: initial.name,
      x: parseFloat(x)||0,
      y: parseFloat(y)||0,
      state_id: stateId || null,
      group_id: groupId || null,
      visible_while_timer_id: visibleTimerId || null,
    };
    const timerMs = ((parseInt(mins)||0)*60 + (parseInt(secs)||0)) * 1000;
    switch (initial.type) {
      case "timer": return { ...base, type: "timer", duration_ms: timerMs||60000, color: timerColor, font_size: parseInt(timerFontSize)||22, show_background: timerBackground, timer_state_id: timerStateId || null, start_with_overlay: startWithOverlay, show_only_running: showOnlyRunning };
      case "icon":  return { ...base, type: "icon",  w: parseInt(iw)||64, h: parseInt(ih)||64, src };
      case "bar":   return { ...base, type: "bar",   w: parseInt(bw)||200, h: parseInt(bh)||20, color: barColor, max_value: parseFloat(maxVal)||100 };
      case "text":  return { ...base, type: "text",  font_size: parseInt(fontSize)||16, color: txtColor, content };
    }
  }

  const typeLabel = initial.type.charAt(0).toUpperCase() + initial.type.slice(1);
  async function save() {
    try { await onSave(build()); }
    catch (error) { reportError(error); }
  }
  const Container = embedded ? "div" : "form";

  return (
    <Container className="overlay-part-editor" aria-label={`${typeLabel} settings`} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}
      onKeyDown={event => {
        if (embedded && event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault(); event.stopPropagation(); void save();
        }
      }}>
      <fieldset disabled={saving}>
        <div className="overlay-part-editor__row">
          {(!embedded || groups.length > 1) && <select className="compact-select" aria-label="Overlay" title="Move this part to another overlay" value={groupId} onChange={event => setGroupId(event.target.value)}>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name || "Overlay"}</option>)}
          </select>}
          <select className="compact-select" aria-label="Show part" title="Show this part always, while a timer runs, or with a state" value={visibleTimerId ? `@timer:${visibleTimerId}` : showOnlyRunning ? "@running" : stateId} onChange={e => {
            const timer = e.target.value.startsWith("@timer:");
            setVisibleTimerId(timer ? e.target.value.slice(7) : "");
            setShowOnlyRunning(e.target.value === "@running");
            setStateId(timer || e.target.value === "@running" ? "" : e.target.value);
          }}>
            <option value="">Always</option>
            {initial.type === "timer" && <option value="@running">While running</option>}
            {timers.filter(timer => timer.id !== initial.id).map(timer => <option key={timer.id} value={`@timer:${timer.id}`}>While {timer.name || "Timer"}</option>)}
            {states.map(state => <option key={state.id} value={state.id}>With {state.name}</option>)}
          </select>
        </div>
        {(!groupId || !groups.some(group => group.id === groupId && (group.layout === "row" || group.layout === "column"))) &&
          <GotoInput x={x} y={y} gameExe={gameExe} onChange={(nx, ny) => { setX(nx); setY(ny); }} />}

        {initial.type === "timer" && <>
          <div className="overlay-part-editor__row">
            <div className="compact-duration" role="group" aria-label="Duration" title="Timer duration">
              <CompactNumber label="Minutes" unit="m" value={mins} onChange={setMins} min={0} />
              <CompactNumber label="Seconds" unit="s" value={secs} onChange={setSecs} min={0} max={59} />
            </div>
            <CompactNumber label="Font size (px)" icon="font" unit="px" value={timerFontSize} onChange={setTimerFontSize} />
            <OverlayColor label="Timer color" value={timerColor} onChange={setTimerColor} />
            <select className="compact-select" aria-label="Timer source" title="Use the fixed duration or read a shared state timer" value={timerStateId} onChange={e => setTimerStateId(e.target.value)}>
              <option value="">Fixed duration</option>
              {states.filter(state => !!state.duration_ms).map(state => <option key={state.id} value={state.id}>{state.name}</option>)}
            </select>
          </div>
          <div className="overlay-part-editor__row overlay-part-editor__flags">
            <label className="checkbox-row" title="Start this timer when its overlay becomes active">
              <input aria-label="Start with overlay" type="checkbox" checked={startWithOverlay} onChange={e => setStartWithOverlay(e.target.checked)} /><span>Auto-start</span>
            </label>
            <label className="checkbox-row" title="Draw a background behind the timer text">
              <input aria-label="Text background" type="checkbox" checked={timerBackground} onChange={e => setTimerBackground(e.target.checked)} /><span>Background</span>
            </label>
          </div>
        </>}

        {initial.type === "icon" && <div className="overlay-part-editor__row">
          <button type="button" className="image-picker" aria-label={src ? "Change image" : "Choose image"} title={src ? "Change image" : "Choose image"} onClick={browseIcon}>
            {src ? <img src={src} className="image-picker__preview image-picker__preview--contain" alt="" style={{ width: `${Math.max(1, parseInt(iw) || 64)}px`, height: `${Math.max(1, parseInt(ih) || 64)}px` }} /> : <Icon name="image" />}
          </button>
          <CompactNumber label="Width (px)" prefix="W" unit="px" value={iw} onChange={setIw} />
          <CompactNumber label="Height (px)" prefix="H" unit="px" value={ih} onChange={setIh} />
          {src && <IconButton icon="trash-can" label="Remove image" className="btn btn--ghost btn--sm" onClick={() => setSrc(null)} />}
        </div>}

        {initial.type === "bar" && <div className="overlay-part-editor__row">
          <CompactNumber label="Width (px)" prefix="W" unit="px" value={bw} onChange={setBw} />
          <CompactNumber label="Height (px)" prefix="H" unit="px" value={bh} onChange={setBh} />
          <CompactNumber label="Maximum value" prefix="Max" value={maxVal} onChange={setMaxVal} />
          <OverlayColor label="Bar color" value={barColor} onChange={setBarColor} />
        </div>}

        {initial.type === "text" && <div className="overlay-part-editor__row">
          <input className="overlay-part-editor__content" aria-label="Content" title="Text content" placeholder="Text" value={content} onChange={e => setContent(e.target.value)} />
          <CompactNumber label="Font size (px)" icon="font" unit="px" value={fontSize} onChange={setFontSize} />
          <OverlayColor label="Text color" value={txtColor} onChange={setTxtColor} />
        </div>}

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button type={embedded ? "button" : "submit"} className="btn btn--primary btn--sm" disabled={!groupId} onClick={embedded ? () => void save() : undefined}>Save</button>
        </div>
      </fieldset>
    </Container>
  );
}
