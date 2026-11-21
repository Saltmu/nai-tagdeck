export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 空や空白だけの ID は採番し直す。前後の空白は除く。 */
export function normalizeId(id: unknown): string {
  if (typeof id !== 'string') return newId();
  const trimmed = id.trim();
  return trimmed ? trimmed : newId();
}
