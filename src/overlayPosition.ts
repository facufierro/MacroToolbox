import { acceptSnapshot, type OverlaySnapshot } from "./overlayRuntime.ts";

export type OverlayBounds = [number, number, number, number];

export type OverlayPresentation = {
  snapshot: OverlaySnapshot;
  origin: OverlayBounds | null;
  generation: number;
};

export function acceptOverlaySnapshot(previous: OverlayPresentation, next: OverlaySnapshot): OverlayPresentation {
  const snapshot = acceptSnapshot(previous.snapshot, next);
  if (snapshot === previous.snapshot) return previous;
  const changedTarget = snapshot.config.profile_id !== previous.snapshot.config.profile_id;
  return {
    snapshot,
    origin: changedTarget ? null : previous.origin,
    generation: previous.generation + Number(changedTarget),
  };
}

export function acceptOverlayOrigin(previous: OverlayPresentation, generation: number, origin: OverlayBounds | null): OverlayPresentation {
  if (generation !== previous.generation || previous.snapshot.config.profile_id === null) return previous;
  return { ...previous, origin };
}

export function toLogicalOverlayBounds(origin: OverlayBounds, scale: number): OverlayBounds {
  return [origin[0] / scale, origin[1] / scale, origin[2] / scale, origin[3] / scale];
}

function resolveCoord(value: number, size: number) {
  return Math.abs(value) <= 100 ? (value / 100) * size : value;
}

export function getOverlayItemPosition(item: { x: number; y: number }, origin: OverlayBounds) {
  return {
    left: origin[0] + resolveCoord(item.x, origin[2]),
    top: origin[1] + resolveCoord(item.y, origin[3]),
  };
}
