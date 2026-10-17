import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

/** Busca de endereços (cada tecla pode gerar uma chamada paga ao Google): por IP. */
export const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Muitas buscas seguidas. Aguarde um instante.' } },
});

/** Limite para rotas sensíveis (login, cadastro, códigos): por IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente em alguns minutos.' } },
});

/** Rota de navegação (consulta paga ao Google, repetida enquanto o veículo anda): por IP. */
export const directionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Muitas consultas de rota. Aguarde um instante.' } },
});
