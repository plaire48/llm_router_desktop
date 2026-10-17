import { createCache } from './cache.mjs';
import { withRetry } from './retry.mjs';
export function createService(fetchItem, { ttlMs = 1000, now } = {}) {
  const cache = createCache(ttlMs, now);
  return async function lookup(key, options = {}) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = await withRetry(() => fetchItem(key), options);
    cache.set(key, value);
    return value;
  };
}
