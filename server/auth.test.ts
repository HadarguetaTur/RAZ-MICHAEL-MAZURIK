import crypto from 'node:crypto';
import { createToken, verifyToken } from './auth';

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(headerB64: string, payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
}

describe('auth token hardening', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.JWT_TOKEN_EPOCH = '0';
  });

  test('creates and verifies token', () => {
    const token = createToken({ username: 'admin', role: 'admin' }, 300);
    const payload = verifyToken(token);
    expect(payload?.username).toBe('admin');
    expect(payload?.role).toBe('admin');
  });

  test('rejects tokens with non-HS256 algorithm header', () => {
    const secret = process.env.JWT_SECRET as string;
    const headerB64 = b64url({ alg: 'none', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const payloadB64 = b64url({
      username: 'admin',
      role: 'admin',
      iat: now,
      exp: now + 300,
      ver: 0,
    });
    const signature = sign(headerB64, payloadB64, secret);
    const token = `${headerB64}.${payloadB64}.${signature}`;
    expect(verifyToken(token)).toBeNull();
  });

  test('rejects old tokens after epoch bump', () => {
    process.env.JWT_TOKEN_EPOCH = '0';
    const token = createToken({ username: 'admin', role: 'admin' }, 300);
    process.env.JWT_TOKEN_EPOCH = '1';
    expect(verifyToken(token)).toBeNull();
  });
});
