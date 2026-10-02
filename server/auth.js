import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'vaultx_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function isPasswordHashConfigured() {
  return Boolean(process.env.VAULT_PASSWORD_HASH);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const params = { cost: 16384, blockSize: 8, parallelization: 1, keyLength: 64 };
  const derivedKey = await scrypt(password, salt, params.keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
  });

  return [
    'scrypt',
    String(params.cost),
    String(params.blockSize),
    String(params.parallelization),
    salt.toString('base64url'),
    Buffer.from(derivedKey).toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password) {
  const storedHash = process.env.VAULT_PASSWORD_HASH;

  if (!storedHash) {
    return false;
  }

  const [scheme, cost, blockSize, parallelization, saltValue, hashValue] = storedHash.split('$');

  if (scheme !== 'scrypt' || !cost || !blockSize || !parallelization || !saltValue || !hashValue) {
    return false;
  }

  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
  });

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  const payload = {
    exp: Date.now() + SESSION_TTL_MS,
    nonce: randomBytes(16).toString('base64url'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature || sign(encodedPayload) !== signature) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function setSessionCookie(response) {
  response.cookie(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, { path: '/' });
}

function sign(value) {
  const secret = process.env.SESSION_SECRET || '';

  return createHmac('sha256', secret).update(value).digest('base64url');
}