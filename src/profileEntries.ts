import { orderOwnedSlots } from "./listOrder.ts";
import type { Profile } from "./types";

type ResolvedProfileEntry<T> = { value: T; own: boolean; key: string };

export function resolveProfileEntries<T>(
  profiles: Profile[],
  profile: Profile,
  select: (profile: Profile) => T[],
  keyOf: (value: T, profile: Profile, index: number) => string,
  visited = new Set<string>(),
): Array<ResolvedProfileEntry<T>> {
  if (visited.has(profile.id)) return [];

  const nextVisited = new Set(visited);
  nextVisited.add(profile.id);

  const resolved: Array<ResolvedProfileEntry<T>> = profile.parent_id
    ? (() => {
        const parent = profiles.find(candidate => candidate.id === profile.parent_id);
        return parent
          ? resolveProfileEntries(profiles, parent, select, keyOf, nextVisited).map(entry => ({ ...entry, own: false }))
          : [];
      })()
    : [];

  const owned = select(profile).map((value, index) => ({ value, own: true, key: keyOf(value, profile, index) }));
  for (const entry of owned) {
    const index = resolved.findIndex(candidate => candidate.key === entry.key);
    if (index >= 0) resolved[index] = entry;
    else resolved.push(entry);
  }

  return orderOwnedSlots(resolved, owned, entry => entry.key);
}
