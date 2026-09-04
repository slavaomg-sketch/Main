import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return out;
}

export function generateOrderPublicId(date = new Date()): string {
  const y = date.getUTCFullYear().toString().slice(2);
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `TM-${y}${m}${d}-${randomCode(5)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
