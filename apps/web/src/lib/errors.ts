import { isDomainError } from '@techmatch/domain';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export function toActionError(e: unknown): ActionResult<never> {
  if (isDomainError(e)) return { ok: false, error: e.message, code: e.code };
  console.error(e);
  return { ok: false, error: 'Что-то пошло не так. Попробуйте ещё раз.' };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return toActionError(e);
  }
}
