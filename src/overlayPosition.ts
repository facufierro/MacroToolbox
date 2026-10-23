export type OverlayBounds = [number, number, number, number];

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
