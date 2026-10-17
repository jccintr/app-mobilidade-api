import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * role: 'passenger' | 'driver' | 'operator_admin' | 'super_admin'
 * tv (tokenVersion): ao trocar a senha, o contador sobe e os tokens antigos deixam de valer.
 */
export function signToken(account, role) {
  return jwt.sign(
    {
      role,
      tid: account.tenantId ? String(account.tenantId) : null,
      tv: account.tokenVersion ?? 0,
    },
    env.jwtSecret,
    { subject: String(account._id), expiresIn: env.jwtExpiresIn, algorithm: 'HS256' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
}
