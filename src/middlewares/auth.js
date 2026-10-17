import { Passenger } from '../models/Passenger.js';
import { Driver } from '../models/Driver.js';
import { AdminUser } from '../models/AdminUser.js';
import { verifyToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, unauthorized } from '../utils/errors.js';

const MODELS = {
  passenger: Passenger,
  driver: Driver,
  operator_admin: AdminUser,
  super_admin: AdminUser,
};

/**
 * Exige login com um dos perfis informados.
 * Garante que o usuário pertence à operadora da requisição (X-Tenant), para que
 * um token de uma operadora nunca funcione em outra.
 */
export function authenticate(...roles) {
  return asyncHandler(async (req, _res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Sessão inválida ou expirada.');
    }

    if (!roles.includes(payload.role)) throw forbidden();

    const user = await MODELS[payload.role].findById(payload.sub);
    if (!user) throw unauthorized('INVALID_TOKEN', 'Sessão inválida ou expirada.');
    if ((user.tokenVersion ?? 0) !== payload.tv) {
      throw unauthorized('SESSION_REVOKED', 'Sua sessão foi encerrada. Entre novamente.');
    }

    if (payload.role === 'super_admin') {
      if (user.role !== 'super_admin' || !user.active) throw forbidden();
    } else {
      if (!req.tenant) throw badRequest('TENANT_REQUIRED', 'Informe a operadora no cabeçalho X-Tenant.');
      if (String(user.tenantId) !== String(req.tenant._id)) {
        throw forbidden('TENANT_MISMATCH', 'Este usuário não pertence a esta operadora.');
      }
      if (payload.role === 'operator_admin' && (user.role !== 'operator_admin' || !user.active)) throw forbidden();
      if (user.status === 'blocked') throw forbidden('ACCOUNT_BLOCKED', 'Conta bloqueada. Fale com a operadora.');
    }

    req.auth = { role: payload.role, id: String(user._id) };
    req.user = user;
    next();
  });
}

/** Para rotas que só liberam depois de confirmar o e-mail (ex.: pedir corrida). */
export function requireVerified(req, _res, next) {
  const required = req.tenant?.settings?.requireEmailVerification !== false;
  if (required && !req.user?.emailVerified) {
    return next(forbidden('EMAIL_NOT_VERIFIED', 'Confirme seu e-mail para continuar.'));
  }
  next();
}
