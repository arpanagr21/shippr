export type { CacheStore } from './types';
export type { CacheProvider } from './factory';
export { createCache } from './factory';

import type { CacheStore } from './types';
import { createCache, type CacheProvider } from './factory';

let _cache: CacheStore;

export function initCache(provider: CacheProvider = 'memory'): void {
  _cache = createCache(provider);
}

export function getCache(): CacheStore {
  if (!_cache) throw new Error('Cache not initialised — call initCache() at startup');
  return _cache;
}

export { getCache as cache };
