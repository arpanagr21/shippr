import type { CacheStore } from './types';
import { MemoryCache } from './memory';

export type CacheProvider = 'memory' | 'redis';

export function createCache(provider: CacheProvider = 'memory'): CacheStore {
  switch (provider) {
    case 'memory':
      return new MemoryCache();
    case 'redis':
      throw new Error('Redis cache not yet implemented');
  }
}
