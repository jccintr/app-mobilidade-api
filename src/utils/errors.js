export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Não autenticado.') => new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'Acesso negado.') => new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Recurso não encontrado.') => new AppError(404, code, message);
export const conflict = (code, message) => new AppError(409, code, message);
