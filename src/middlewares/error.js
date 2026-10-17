import { ZodError } from 'zod';
import multer from 'multer';
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada.' } });
}

const send = (res, status, code, message, details) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return send(
      res,
      400,
      'VALIDATION_ERROR',
      'Dados inválidos.',
      err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.details);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'FILE_TOO_LARGE', 'Arquivo grande demais.');
    return send(res, 400, 'UPLOAD_ERROR', 'Não foi possível processar o arquivo enviado.');
  }

  if (err?.type === 'entity.parse.failed') return send(res, 400, 'INVALID_JSON', 'JSON inválido.');
  if (err?.type === 'entity.too.large') return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Requisição grande demais.');

  if (err instanceof mongoose.Error.CastError) return send(res, 400, 'INVALID_ID', 'Identificador inválido.');
  if (err instanceof mongoose.Error.ValidationError) return send(res, 400, 'VALIDATION_ERROR', 'Dados inválidos.');

  if (err?.code === 11000) {
    return send(res, 409, 'DUPLICATE', 'Já existe um registro com estes dados.');
  }

  console.error(err);
  return send(res, 500, 'INTERNAL_ERROR', env.nodeEnv === 'production' ? 'Erro interno.' : String(err?.message ?? err));
}
