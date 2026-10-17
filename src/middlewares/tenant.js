import { Tenant } from '../models/Tenant.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

// Cache curto em memória: evita uma consulta ao banco a cada requisição.
const cache = new Map();
const TTL_MS = 30_000;
const MAX_ENTRIES = 500;

export function invalidateTenantCache(slug) {
  if (slug) cache.delete(slug);
  else cache.clear();
}

/** Descobre a operadora pelo cabeçalho X-Tenant (slug). Tudo que vem depois é filtrado por ela. */
export const resolveTenant = asyncHandler(async (req, _res, next) => {
  const slug = String(req.get('x-tenant') ?? '')
    .trim()
    .toLowerCase();
  if (!slug) throw badRequest('TENANT_REQUIRED', 'Informe a operadora no cabeçalho X-Tenant.');

  let entry = cache.get(slug);
  if (!entry || entry.expires < Date.now()) {
    const tenant = await Tenant.findOne({ slug }).lean();
    if (!tenant) throw notFound('TENANT_NOT_FOUND', 'Operadora não encontrada.');
    if (cache.size >= MAX_ENTRIES) cache.clear();
    entry = { tenant, expires: Date.now() + TTL_MS };
    cache.set(slug, entry);
  }

  if (!entry.tenant.active) throw forbidden('TENANT_INACTIVE', 'Esta operadora está desativada.');
  req.tenant = entry.tenant;
  next();
});
