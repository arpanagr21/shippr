/**
 * Factory that instantiates the right Coolify adapter for the configured API version.
 *
 * To add support for a new Coolify API version:
 *   1. Create server/src/coolify/vN.ts implementing CoolifyAdapter
 *   2. Add it to the `adapters` map below
 *   3. Set COOLIFY_API_VERSION=vN in .env
 */

import type { CoolifyAdapter } from './adapter';
import { V1Adapter }           from './v1';
import { config }              from '../config';

const adapters: Record<string, () => CoolifyAdapter> = {
  v1: () => new V1Adapter(),
};

function createCoolifyClient(version: string): CoolifyAdapter {
  const factory = adapters[version];
  if (!factory) {
    const supported = Object.keys(adapters).join(', ');
    throw new Error(`Unsupported Coolify API version: "${version}". Supported: ${supported}`);
  }
  return factory();
}

// Singleton — one adapter per server process.
export const coolify: CoolifyAdapter = createCoolifyClient(config.coolifyApiVersion);
