import bcrypt from 'bcryptjs';
import { AdminUser } from '../../models/AdminUser.js';
import { Tenant } from '../../models/Tenant.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../../utils/errors.js';
import { signToken } from '../../utils/tokens.js';
import { invalidateTenantCache } from '../../middlewares/tenant.js';

const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', 10);

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Pontos de ponto (.) viram caminhos do Mongo ($set) para atualizar só o que foi enviado. */
function flatten(source, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

export const superController = {
  async login(req, res) {
    const { email, password } = req.valid;
    const admin = await AdminUser.findOne({ tenantId: null, email, role: 'super_admin' }).select('+passwordHash');
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok) throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    if (!admin.active) throw forbidden('ACCOUNT_BLOCKED', 'Acesso desativado.');

    await AdminUser.updateOne({ _id: admin._id }, { lastLoginAt: new Date() });
    res.json({ token: signToken(admin, 'super_admin'), user: admin });
  },

  async listTenants(_req, res) {
    res.json({ data: await Tenant.find().sort({ createdAt: -1 }).limit(500) });
  },

  async createTenant(req, res) {
    const body = req.valid;
    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw new AppError(400, 'INVALID_TIMEZONE', 'Fuso horário inválido.');
    }
    if (await Tenant.exists({ slug: body.slug })) throw conflict('SLUG_IN_USE', 'Este identificador (slug) já está em uso.');
    res.status(201).json({ tenant: await Tenant.create(body) });
  },

  async updateTenant(req, res) {
    const body = req.valid;
    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw new AppError(400, 'INVALID_TIMEZONE', 'Fuso horário inválido.');
    }
    // `cities` é lista: substitui inteira. Objetos (brand, settings) atualizam só os campos enviados.
    const { id, ...fields } = body;
    const tenant = await Tenant.findByIdAndUpdate(id, { $set: flatten(fields) }, { returnDocument: 'after', runValidators: true });
    if (!tenant) throw notFound('TENANT_NOT_FOUND', 'Operadora não encontrada.');
    invalidateTenantCache(tenant.slug);
    res.json({ tenant });
  },

  async createOperatorAdmin(req, res) {
    const { id, name, email, password } = req.valid;
    const tenant = await Tenant.findById(id);
    if (!tenant) throw notFound('TENANT_NOT_FOUND', 'Operadora não encontrada.');
    if (await AdminUser.exists({ tenantId: tenant._id, email })) {
      throw conflict('EMAIL_IN_USE', 'Este e-mail já é administrador desta operadora.');
    }
    const admin = await AdminUser.create({
      tenantId: tenant._id,
      role: 'operator_admin',
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
    });
    res.status(201).json({ user: admin });
  },
};
