import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 32_768;
const R = 8;
const P = 1;
const LEN = 32;
const opts = (n: number, r: number, p: number) => ({ N: n, r, p, maxmem: 128 * n * r * 2 });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, LEN, opts(N, R, P));
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [tag, n, r, p, salt, key] = stored.split('$');
  if (tag !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, opts(Number(n), Number(r), Number(p)));
  return timingSafeEqual(got, want);
}
