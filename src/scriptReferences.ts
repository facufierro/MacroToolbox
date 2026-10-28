import { mapBehavior } from "./behaviors.ts";
import type { Profile, Scope, Script } from "./types";

export function mapScriptActions(behavior: string, mapId: (id: string) => string | null) {
  return mapBehavior(behavior, step => {
    if (step.type !== "script") return step;
    const scriptId = mapId(step.scriptId);
    return scriptId === null ? null : { ...step, scriptId };
  });
}

export function withReferencedScripts(profile: Profile, scripts: Script[]): Profile {
  const ids = new Set(profile.scripts.map(script => script.id));
  for (const entry of [...profile.hotkeys, ...(profile.events ?? [])]) {
    mapScriptActions(entry.behavior, id => { ids.add(id); return id; });
  }
  return { ...profile, scripts: scripts.filter(script => ids.has(script.id)) };
}

export function carryReferencedScripts(profile: Profile, source: Script[], target: Script[]): Profile {
  const existing = new Set([...profile.scripts, ...target].map(script => script.id));
  return { ...profile, scripts: [...profile.scripts, ...withReferencedScripts(profile, source).scripts.filter(script => !existing.has(script.id))] };
}

export function removeScriptReferences(scope: Scope, scriptId: string): Scope {
  const remove = (behavior: string) => mapScriptActions(behavior, id => id === scriptId ? null : id);
  return { ...scope, profiles: scope.profiles.map(profile => ({ ...profile,
    hotkeys: profile.hotkeys.map(hotkey => ({ ...hotkey, behavior: remove(hotkey.behavior) })),
    events: profile.events.map(event => ({ ...event, behavior: remove(event.behavior) })),
  })) };
}
