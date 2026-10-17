export function createCache(ttlMs, now = Date.now) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw Error('invalid_ttl');
  const entries = new Map();
  return {
    set(key, value) { entries.set(key, { value, expiresAt: now() + ttlMs }); },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) { entries.delete(key); return undefined; }
      return entry.value;
    },
  };
}
