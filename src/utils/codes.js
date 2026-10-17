import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** Código numérico de 6 dígitos (e-mail de verificação / recuperação de senha). */
export function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** O código nunca é guardado em texto puro: guardamos o HMAC dele. */
export function hashCode(code, secret = env.jwtSecret) {
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

export function newCodeRecord(code, { now = new Date(), ttlMinutes = env.code.ttlMinutes } = {}) {
  return {
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    attempts: 0,
    requestedAt: now,
  };
}

/**
 * Confere um código contra o registro guardado.
 * Retorna: 'ok' | 'missing' | 'expired' | 'locked' | 'invalid'
 */
export function checkCode(record, code, { maxAttempts = env.code.maxAttempts, now = new Date(), secret } = {}) {
  if (!record?.codeHash) return 'missing';
  if (!record.expiresAt || record.expiresAt.getTime() <= now.getTime()) return 'expired';
  if ((record.attempts ?? 0) >= maxAttempts) return 'locked';

  const expected = Buffer.from(record.codeHash, 'hex');
  const received = Buffer.from(hashCode(code, secret), 'hex');
  if (expected.length !== received.length) return 'invalid';
  return crypto.timingSafeEqual(expected, received) ? 'ok' : 'invalid';
}

/** Impede reenvio em sequência. */
export function isTooSoon(record, { now = new Date(), resendSeconds = env.code.resendSeconds } = {}) {
  if (!record?.requestedAt) return false;
  return now.getTime() - record.requestedAt.getTime() < resendSeconds * 1000;
}
