import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';

const KEYLEN = 64;
const N = 16384;

/** scrypt-хеш пароля (без нативных зависимостей). Формат: scrypt$N$salt$hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N }).toString('hex');
  return `scrypt$${N}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, nStr, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !nStr || !salt || !hash) return false;
  const derived = scryptSync(password, salt, KEYLEN, { N: Number(nStr) });
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacVerify(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(hmacSign(secret, payload), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
