import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const missingPassword = { salt: '0'.repeat(32), hash: '0'.repeat(128) };
export const usernamePattern = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const secret = (length = 32) => randomBytes(length).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, parameters);
  return { salt, hash: hash.toString('hex') };
}

export async function passwordMatches(password, { salt, hash } = missingPassword) {
  const actual = await derive(password, salt, 64, parameters);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export async function createAccount(username, name, role) {
  const password = secret(18);
  const credential = await hashPassword(password);
  return {
    password,
    user: { username, name, role, credential, active: true, history: [] },
  };
}
