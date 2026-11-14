// Order is a field on each item, not a shared array that can overwrite membership.
export function orderedItems(items) {
  return [...items].sort((a, b) => {
    const ar = Number.isFinite(a.order) ? a.order : a.created || 0;
    const br = Number.isFinite(b.order) ? b.order : b.created || 0;
    return ar - br || String(a.id).localeCompare(String(b.id));
  });
}

export function reorderItems(items, { order, item, position } = {}) {
  let next;
  if (order !== undefined) {
    if (item !== undefined || position !== undefined) return 'Use either a full order or item and position.';
    if (!Array.isArray(order) || order.length !== items.length || new Set(order).size !== items.length || order.some((id) => !items.some((x) => x.id === id))) {
      return 'Order must contain every item id exactly once.';
    }
    next = order.map((id) => items.find((x) => x.id === id));
  } else {
    next = orderedItems(items);
    const from = next.findIndex((x) => x.id === item);
    if (from < 0 || !Number.isInteger(position) || position < 1 || position > next.length) return 'Give an existing item id and a position from 1 to the item count.';
    const [moving] = next.splice(from, 1);
    next.splice(position - 1, 0, moving);
    // Change only the moved item's rank: concurrent moves of other items survive.
    const before = next[position - 2], after = next[position];
    if (next.every((x) => Number.isFinite(x.order))) {
      moving.order = before && after ? (before.order + after.order) / 2 : before ? before.order + 1 : after ? after.order - 1 : 0;
      if (!before || !after || (moving.order > before.order && moving.order < after.order)) return null;
    }
  }
  next.forEach((x, i) => { x.order = i; });
  return null;
}

export const appendOrder = (items) => Math.max(-1, ...items.map((x) => Number.isFinite(x.order) ? x.order : x.created || 0)) + 1;
