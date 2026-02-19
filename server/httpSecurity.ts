import http from 'node:http';
import net from 'node:net';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1MB

export function getTrustedClientIp(req: http.IncomingMessage): string {
  const remote = req.socket.remoteAddress || '';
  // In production (Railway/Render), always trust X-Forwarded-For
  // since the app sits behind a managed reverse proxy.
  // Locally, only trust when remoteAddress is loopback.
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  const trustedProxy = isProduction || remote === '127.0.0.1' || remote === '::1';

  const forwarded = req.headers['x-forwarded-for'];
  if (trustedProxy && typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return remote || 'unknown';
}

export function isValidRecordId(value: string): boolean {
  return /^rec[a-zA-Z0-9]{14}$/.test(value);
}

export async function readBodyWithLimit(
  req: http.IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function readJsonBodyWithLimit<T>(
  req: http.IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<T> {
  const raw = await readBodyWithLimit(req, maxBytes);
  return JSON.parse(raw || '{}') as T;
}

export function assertJsonContentType(req: http.IncomingMessage): boolean {
  const contentType = (req.headers['content-type'] || '').toString().toLowerCase();
  return contentType.includes('application/json');
}

export function isPublicIp(ip: string): boolean {
  if (!ip || !net.isIP(ip)) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) return false;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1] || '0');
    if (second >= 16 && second <= 31) return false;
  }
  if (ip === '::1') return false;
  return true;
}
