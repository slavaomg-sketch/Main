import 'server-only';
import { cookies } from 'next/headers';

export const FAV_COOKIE = 'tm_fav';

export async function getGuestFavoriteIds(): Promise<string[]> {
  const jar = await cookies();
  const raw = jar.get(FAV_COOKIE)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}
