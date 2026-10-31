export function moveItem<T>(items: T[], keyOf: (item: T, index: number) => string, from: string, to: string, after: boolean): T[] {
  const source = items.findIndex((item, index) => keyOf(item, index) === from);
  const target = items.findIndex((item, index) => keyOf(item, index) === to);
  if (source < 0 || target < 0 || source === target) return items;
  const insertion = target + Number(after) - Number(source < target);
  if (insertion === source) return items;
  const next = [...items];
  const [item] = next.splice(source, 1);
  next.splice(insertion, 0, item);
  return next;
}

// Inherited entries keep their slots; owned entries follow their source array's order.
export function orderOwnedSlots<T>(resolved: T[], owned: T[], keyOf: (item: T) => string): T[] {
  const order = new Map(owned.map((item, index) => [keyOf(item), index]));
  const sorted = resolved.filter(item => order.has(keyOf(item)))
    .sort((a, b) => order.get(keyOf(a))! - order.get(keyOf(b))!);
  let index = 0;
  return resolved.map(item => order.has(keyOf(item)) ? sorted[index++] : item);
}
