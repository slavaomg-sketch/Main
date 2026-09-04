'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@techmatch/database';
import { toggleFavorite } from '@techmatch/domain';
import { cookieOptions, getCustomer } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/errors';
import { FAV_COOKIE, getGuestFavoriteIds } from '@/lib/favorites';

export async function toggleFavoriteAction(productId: string): Promise<ActionResult<{ active: boolean; count: number }>> {
  return runAction(async () => {
    const customer = await getCustomer();
    if (customer) {
      const active = await toggleFavorite(prisma, customer.customer.id, productId);
      const count = await prisma.favorite.count({ where: { customerId: customer.customer.id } });
      revalidatePath('/', 'layout');
      return { active, count };
    }
    const jar = await cookies();
    const ids = await getGuestFavoriteIds();
    const active = !ids.includes(productId);
    const next = active ? [...ids, productId] : ids.filter((id) => id !== productId);
    jar.set(FAV_COOKIE, JSON.stringify(next), cookieOptions(180 * 86_400));
    revalidatePath('/', 'layout');
    return { active, count: next.length };
  });
}
