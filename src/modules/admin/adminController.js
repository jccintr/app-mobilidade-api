import bcrypt from 'bcryptjs';
import { AdminUser } from '../../models/AdminUser.js';
import { Driver } from '../../models/Driver.js';
import { Passenger } from '../../models/Passenger.js';
import { Ride } from '../../models/Ride.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../../utils/errors.js';
import { checkCode, generateCode, isTooSoon, newCodeRecord } from '../../utils/codes.js';
import { signToken } from '../../utils/tokens.js';
import { storage } from '../../services/storage/index.js';
import { isProfileComplete } from '../accounts/driverStatus.js';
import { sendPush } from '../../services/push.js';
import { sendDriverReviewEmail, sendPasswordResetCode } from '../../services/mailer.js';
import { grantWelcomeCredit } from '../../billing/wallet.js';

const DAY = 24 * 60 * 60;

/**
 * Avisa o motorista por push e por e-mail (melhor esforço: se algum falhar, o app também confere o status sozinho).
 * O e-mail garante o aviso mesmo se o motorista desligou as notificações do celular.
 */
function notifyDriver(driver, tenant, { title, body, type, approved, reason }) {
  sendPush(driver.pushToken, { title, body, data: { type }, ttl: DAY, channelId: 'ofertas' }).catch(() => {});
  sendDriverReviewEmail({ to: driver.email, name: driver.name, tenant, approved, reason }).catch((error) =>
    console.error('[mailer] falha ao enviar aviso de análise:', error?.message ?? error),
  );
}

const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', 10);

const codeError = (result) => {
  switch (result) {
    case 'locked':
      return new AppError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Solicite um novo código.');
    case 'missing':
    case 'expired':
      return new AppError(400, 'CODE_EXPIRED', 'Código expirado. Solicite um novo.');
    default:
      return new AppError(400, 'INVALID_CODE', 'Código incorreto.');
  }
};

/** Administrador da operadora pelo e-mail (com os campos escondidos que a recuperação precisa). */
const findOperatorAdmin = (req, email, fields) =>
  AdminUser.findOne({ tenantId: req.tenant._id, email, role: 'operator_admin' }).select(fields);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function paginate(Model, filter, { page, limit }, sort = { createdAt: -1 }) {
  const [data, total] = await Promise.all([
    Model.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Model.countDocuments(filter),
  ]);
  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function findDriver(req) {
  const driver = await Driver.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
  if (!driver) throw notFound('DRIVER_NOT_FOUND', 'Motorista não encontrado.');
  return driver;
}

async function findPassenger(req) {
  const passenger = await Passenger.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
  if (!passenger) throw notFound('PASSENGER_NOT_FOUND', 'Passageiro não encontrado.');
  return passenger;
}

export const adminController = {
  // ---- login do administrador da operadora ----
  async login(req, res) {
    const { email, password } = req.valid;
    const admin = await AdminUser.findOne({ tenantId: req.tenant._id, email, role: 'operator_admin' }).select(
      '+passwordHash',
    );
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok) throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    if (!admin.active) throw forbidden('ACCOUNT_BLOCKED', 'Acesso desativado.');

    await AdminUser.updateOne({ _id: admin._id }, { lastLoginAt: new Date() });
    res.json({ token: signToken(admin, 'operator_admin'), user: admin });
  },

  // ---- recuperação de senha do administrador (resposta igual exista ou não a conta) ----
  async passwordRequest(req, res) {
    const admin = await findOperatorAdmin(req, req.valid.email, '+passwordReset');
    if (admin?.active && !isTooSoon(admin.passwordReset)) {
      const code = generateCode();
      admin.passwordReset = newCodeRecord(code);
      await admin.save();
      sendPasswordResetCode({ to: admin.email, name: admin.name, code, tenant: req.tenant }).catch((error) =>
        console.error('[mailer] falha ao enviar código de recuperação do admin:', error?.message ?? error),
      );
    }
    res.json({ sent: true });
  },

  async passwordReset(req, res) {
    const { email, code, password } = req.valid;
    const admin = await findOperatorAdmin(req, email, '+passwordReset +passwordHash');
    const result = admin?.active ? checkCode(admin.passwordReset, code) : 'invalid';
    if (result !== 'ok') {
      if (admin && result === 'invalid') await AdminUser.updateOne({ _id: admin._id }, { $inc: { 'passwordReset.attempts': 1 } });
      throw codeError(result);
    }

    admin.passwordHash = await bcrypt.hash(password, 10);
    admin.passwordReset = undefined;
    admin.tokenVersion = (admin.tokenVersion ?? 0) + 1; // encerra as sessões abertas com a senha antiga
    await admin.save();
    res.json({ ok: true });
  },

  me(req, res) {
    res.json({ user: req.user, tenant: { id: String(req.tenant._id), name: req.tenant.name, slug: req.tenant.slug } });
  },

  // ---- motoristas ----
  async listDrivers(req, res) {
    const { status, q, page, limit } = req.valid;
    const filter = { tenantId: req.tenant._id };
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { 'vehicle.plate': rx }];
    }
    res.json(await paginate(Driver, filter, { page, limit }));
  },

  async getDriver(req, res) {
    const driver = await findDriver(req);
    res.json({ driver, complete: isProfileComplete(driver) });
  },

  /** Entrega o documento (privado) do motorista para o administrador conferir. */
  async driverDocument(req, res) {
    const driver = await findDriver(req);
    const asset = driver.documents?.[req.valid.type];
    if (!asset?.key) throw notFound('DOCUMENT_NOT_FOUND', 'Documento não enviado.');
    // ?link=1: devolve só o endereço temporário (para <img>/<iframe> do painel, que não enviam o token).
    if (req.query.link && asset.provider === 'cloudinary') {
      return res.json({ url: storage.signedUrl(asset), expiresInSeconds: 300 });
    }
    await storage.sendPrivate(asset, res);
  },

  async approveDriver(req, res) {
    const driver = await findDriver(req);
    if (!['pending_approval', 'rejected'].includes(driver.status)) {
      throw conflict('INVALID_STATE', `Não é possível aprovar um motorista com status "${driver.status}".`);
    }
    if (!isProfileComplete(driver)) {
      throw conflict('INCOMPLETE_PROFILE', 'O cadastro do motorista está incompleto (veículo ou documentos).');
    }
    driver.status = 'approved';
    driver.approvedAt = new Date();
    driver.approvedBy = req.user._id;
    driver.rejectionReason = undefined;
    await driver.save();
    // Crédito de boas-vindas (se a operadora definiu um valor): uma vez por motorista, mesmo se for reaprovado.
    await grantWelcomeCredit({ tenant: req.tenant, driverId: driver._id, adminId: req.user._id }).catch((error) =>
      console.error('[wallet] falha ao dar o crédito de boas-vindas', String(driver._id), error),
    );
    notifyDriver(driver, req.tenant, {
      approved: true,
      type: 'driver:approved',
      title: 'Cadastro aprovado!',
      body: `Você já pode ficar online e receber corridas${req.tenant.brand?.displayName ? ` na ${req.tenant.brand.displayName}` : ''}.`,
    });
    res.json({ driver });
  },

  async rejectDriver(req, res) {
    const driver = await findDriver(req);
    if (!['pending_approval', 'approved'].includes(driver.status)) {
      throw conflict('INVALID_STATE', `Não é possível reprovar um motorista com status "${driver.status}".`);
    }
    driver.status = 'rejected';
    driver.rejectionReason = req.valid.reason;
    driver.online = false;
    await driver.save();
    notifyDriver(driver, req.tenant, {
      approved: false,
      reason: req.valid.reason,
      type: 'driver:rejected',
      title: 'Cadastro precisa de ajustes',
      body: `${req.valid.reason} Abra o app para corrigir e reenviar.`,
    });
    res.json({ driver });
  },

  async blockDriver(req, res) {
    const driver = await findDriver(req);
    if (driver.status === 'blocked') throw conflict('INVALID_STATE', 'Motorista já está bloqueado.');
    driver.statusBeforeBlock = driver.status;
    driver.status = 'blocked';
    driver.online = false;
    driver.tokenVersion = (driver.tokenVersion ?? 0) + 1; // derruba a sessão atual
    await driver.save();
    res.json({ driver });
  },

  async unblockDriver(req, res) {
    const driver = await findDriver(req);
    if (driver.status !== 'blocked') throw conflict('INVALID_STATE', 'Motorista não está bloqueado.');
    const previous = driver.statusBeforeBlock;
    driver.status = previous && previous !== 'blocked' ? previous : 'pending_approval';
    driver.statusBeforeBlock = undefined;
    await driver.save();
    res.json({ driver });
  },

  // ---- passageiros ----
  async listPassengers(req, res) {
    const { status, q, page, limit } = req.valid;
    const filter = { tenantId: req.tenant._id };
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    const result = await paginate(Passenger, filter, { page, limit });
    // Quantas corridas cada passageiro desta página já pediu (e quantas concluiu).
    const counts = await Ride.aggregate([
      { $match: { tenantId: req.tenant._id, passengerId: { $in: result.data.map((p) => p._id) } } },
      { $group: { _id: '$passengerId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
    ]);
    const byId = new Map(counts.map((row) => [String(row._id), row]));
    result.data = result.data.map((passenger) => ({
      ...passenger.toJSON(),
      rides: { total: byId.get(String(passenger._id))?.total ?? 0, completed: byId.get(String(passenger._id))?.completed ?? 0 },
    }));
    res.json(result);
  },

  async blockPassenger(req, res) {
    const passenger = await findPassenger(req);
    if (passenger.status === 'blocked') throw conflict('INVALID_STATE', 'Passageiro já está bloqueado.');
    passenger.status = 'blocked';
    passenger.tokenVersion = (passenger.tokenVersion ?? 0) + 1;
    await passenger.save();
    res.json({ passenger });
  },

  async unblockPassenger(req, res) {
    const passenger = await findPassenger(req);
    if (passenger.status !== 'blocked') throw conflict('INVALID_STATE', 'Passageiro não está bloqueado.');
    passenger.status = 'active';
    await passenger.save();
    res.json({ passenger });
  },
};
