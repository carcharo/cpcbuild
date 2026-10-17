import { randomBytes } from 'crypto';

/** A fresh CSP nonce from the system's CSPRNG (Math.random is predictable). */
export function nonce(): string {
  return randomBytes(18).toString('base64url');
}
