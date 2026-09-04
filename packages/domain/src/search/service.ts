import type { DbClient } from '@techmatch/database';
import { searchDevices, type DeviceCandidate } from '../devices/service';
import { suggestProducts } from '../catalog/service';
import type { ProductCardDTO } from '../catalog/service';

/**
 * SearchProvider — абстракция для будущего перехода на внешний поисковый движок.
 * Сейчас: PostgreSQL (pg_trgm + FTS + нормализованные алиасы).
 */
export interface SearchProvider {
  readonly code: string;
  suggest(db: DbClient, query: string): Promise<SuggestResult>;
}

export interface SuggestResult {
  devices: DeviceCandidate[];
  products: ProductCardDTO[];
  resolution: 'exact' | 'ambiguous' | 'none';
  hint: string | null;
}

export class PostgresSearchProvider implements SearchProvider {
  readonly code = 'postgres';
  async suggest(db: DbClient, query: string): Promise<SuggestResult> {
    const [devices, products] = await Promise.all([searchDevices(db, query, { limit: 6 }), suggestProducts(db, query, 4)]);
    return { devices: devices.candidates, products, resolution: devices.resolution, hint: devices.disambiguationHint };
  }
}

let provider: SearchProvider = new PostgresSearchProvider();
export const getSearchProvider = () => provider;
export const setSearchProvider = (p: SearchProvider) => {
  provider = p;
};
