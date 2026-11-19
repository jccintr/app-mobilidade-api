import { Driver } from '../../models/Driver.js';
import { CreditPackage } from '../../models/CreditPackage.js';
import { CreditPurchase } from '../../models/CreditPurchase.js';
import { WalletEntry } from '../../models/WalletEntry.js';
import { billingConfig } from '../../billing/fee.js';
import { applyWalletEntry, grantWelcomeCredit } from '../../billing/wallet.js';
import { sendCreditReviewedEmail } from '../../services/mailer.js';
import { sendPush } from '../../services/push.js';
import { storage } from '../../services/storage/index.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { expireStalePurchases, serializePurchase } from './purchases.js';

/** Painel da operadora: pacotes, fila de compras (conferência do Pix), saldo/extrato e ajustes. */

const DAY = 24 * 3600;
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function findPackage(req) {
  const pkg = await CreditPackage.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
  if (!pkg) throw notFound('PACKAGE_NOT_FOUND', 'Pacote não encontrado.');
  return pkg;
}

async function findDriver(req) {
  const driver = await Driver.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
  if (!driver) throw notFound('DRIVER_NOT_FOUND', 'Motorista não encontrado.');
  return driver;
}

async function adminPurchaseView(purchase) {
  const json = await serializePurchase(purchase);
  const driver = purchase.populated('driverId') ? purchase.driverId : null;
  json.driverId = String(driver?._id ?? purchase.driverId);
  json.driver = driver ? { id: String(driver._id), name: driver.name, email: driver.email, phone: driver.phone } : null;
  return json;
}

function notifyDriverPurchase(driver, tenant, purchase, { confirmed, reason, balanceCents }) {
  const title = confirmed ? 'Créditos liberados!' : 'Compra de créditos recusada';
  const body = confirmed
    ? `${brl(purchase.package.creditCents)} entraram no seu saldo. Saldo atual: ${brl(balanceCents)}.`
    : `${reason} Fale com a operadora se precisar.`;
  sendPush(driver.pushToken, { title, body, data: { type: confirmed ? 'credit:confirmed' : 'credit:rejected' }, ttl: DAY }).catch(() => {});
  sendCreditReviewedEmail({ to: driver.email, name: driver.name, tenant, purchase, confirmed, reason, balanceCents }).catch((error) =>
    console.error('[mailer] falha ao avisar o motorista sobre a compra de créditos:', error?.message ?? error),
  );
}

export const adminCreditsController = {
  // ------------------------------------------------------------------ pacotes
  async listPackages(req, res) {
    const packages = await CreditPackage.find({ tenantId: req.tenant._id }).sort({ priceCents: 1 });
    res.json({ data: packages });
  },

  async createPackage(req, res) {
    const pkg = await CreditPackage.create({ ...req.valid, tenantId: req.tenant._id });
    res.status(201).json({ package: pkg });
  },

  async updatePackage(req, res) {
    const pkg = await findPackage(req);
    const { id: _id, ...changes } = req.valid;
    Object.assign(pkg, changes);
    if (pkg.creditCents < pkg.priceCents) throw badRequest('INVALID_PACKAGE', 'O crédito não pode ser menor que o preço do pacote.');
    await pkg.save();
    res.json({ package: pkg });
  },

  /** Excluir é seguro: cada compra guarda a cópia do pacote. */
  async deletePackage(req, res) {
    const pkg = await findPackage(req);
    await pkg.deleteOne();
    res.json({ ok: true });
  },

  // ------------------------------------------------------------------ compras
  /** Contadores para o destaque no painel: informed = disseram que pagaram; pending = Pix gerado, sem aviso. */
  async summary(req, res) {
    const tenantId = req.tenant._id;
    await expireStalePurchases({ tenantId });
    const [informed, pending] = await Promise.all([
      CreditPurchase.countDocuments({ tenantId, status: 'informed' }),
      CreditPurchase.countDocuments({ tenantId, status: 'pending' }),
    ]);
    res.json({ informed, pending });
  },

  /** status "open" = pending + informed (os informados primeiro, porque são os que pedem ação). */
  async listPurchases(req, res) {
    const tenantId = req.tenant._id;
    const { status, driverId, page, limit } = req.valid;
    await expireStalePurchases({ tenantId });
    const filter = { tenantId };
    if (status === 'open') filter.open = true;
    else if (status) filter.status = status;
    if (driverId) filter.driverId = driverId;

    const sort = status === 'open' ? { status: 1, informedAt: -1, createdAt: -1 } : { createdAt: -1 };
    const [purchases, total] = await Promise.all([
      CreditPurchase.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).populate('driverId', 'name email phone'),
      CreditPurchase.countDocuments(filter),
    ]);
    res.json({
      data: await Promise.all(purchases.map(adminPurchaseView)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  },

  /** Comprovante (privado). ?link=1 devolve um endereço temporário, para <img>/<iframe> do painel. */
  async receipt(req, res) {
    const purchase = await CreditPurchase.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
    if (!purchase?.receipt?.key) throw notFound('RECEIPT_NOT_FOUND', 'Esta compra não tem comprovante.');
    if (req.query.link && purchase.receipt.provider === 'cloudinary') {
      return res.json({ url: storage.signedUrl(purchase.receipt), expiresInSeconds: 300 });
    }
    await storage.sendPrivate(purchase.receipt, res);
  },

  /**
   * Confirma o pagamento e credita o saldo. Vale para compra informada, ainda pendente (a operadora viu o Pix
   * sem o aviso) ou vencida (o motorista pagou depois do prazo). O crédito é lançado uma vez só (índice único).
   */
  async confirmPurchase(req, res) {
    const tenantId = req.tenant._id;
    const purchase = await CreditPurchase.findOneAndUpdate(
      { _id: req.valid.id, tenantId, status: { $in: ['pending', 'informed', 'expired'] } },
      { $set: { status: 'confirmed', open: false, confirmedAt: new Date(), confirmedBy: req.user._id } },
      { returnDocument: 'after' },
    );
    if (!purchase) {
      const exists = await CreditPurchase.findOne({ _id: req.valid.id, tenantId }).select('status');
      if (!exists) throw notFound('PURCHASE_NOT_FOUND', 'Compra não encontrada.');
      throw conflict('INVALID_STATE', `Não é possível confirmar uma compra com status "${exists.status}".`);
    }

    const result = await applyWalletEntry({
      tenantId,
      driverId: purchase.driverId,
      type: 'purchase',
      amountCents: purchase.package.creditCents,
      purchaseId: purchase._id,
      adminId: req.user._id,
      note: `Compra ${purchase.code} — ${purchase.package.name}`,
    });
    const driver = await Driver.findById(purchase.driverId);
    if (driver && result?.entry) {
      notifyDriverPurchase(driver, req.tenant, purchase, { confirmed: true, balanceCents: result.balanceCents });
    }
    await purchase.populate('driverId', 'name email phone');
    res.json({ purchase: await adminPurchaseView(purchase), balanceCents: result?.balanceCents ?? driver?.wallet?.balanceCents ?? 0 });
  },

  async rejectPurchase(req, res) {
    const tenantId = req.tenant._id;
    const purchase = await CreditPurchase.findOneAndUpdate(
      { _id: req.valid.id, tenantId, status: { $in: ['pending', 'informed'] } },
      {
        $set: { status: 'rejected', open: false, rejectedAt: new Date(), rejectedBy: req.user._id, rejectionReason: req.valid.reason },
      },
      { returnDocument: 'after' },
    );
    if (!purchase) {
      const exists = await CreditPurchase.findOne({ _id: req.valid.id, tenantId }).select('status');
      if (!exists) throw notFound('PURCHASE_NOT_FOUND', 'Compra não encontrada.');
      throw conflict('INVALID_STATE', `Não é possível recusar uma compra com status "${exists.status}".`);
    }
    const driver = await Driver.findById(purchase.driverId);
    if (driver) notifyDriverPurchase(driver, req.tenant, purchase, { confirmed: false, reason: req.valid.reason });
    await purchase.populate('driverId', 'name email phone');
    res.json({ purchase: await adminPurchaseView(purchase) });
  },

  // ------------------------------------------------------------ saldo do motorista
  async driverWallet(req, res) {
    const driver = await findDriver(req);
    const { page, limit } = req.valid;
    const filter = { tenantId: req.tenant._id, driverId: driver._id };
    const [entries, total] = await Promise.all([
      WalletEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      WalletEntry.countDocuments(filter),
    ]);
    res.json({
      balanceCents: driver.wallet?.balanceCents ?? 0,
      welcomeGrantedAt: driver.wallet?.welcomeGrantedAt ?? null,
      entries: { data: entries, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  },

  /** Ajuste manual (cortesia, correção). Negativo só até zerar o saldo. */
  async adjustWallet(req, res) {
    const driver = await findDriver(req);
    const result = await applyWalletEntry({
      tenantId: req.tenant._id,
      driverId: driver._id,
      type: 'adjustment',
      amountCents: req.valid.amountCents,
      adminId: req.user._id,
      note: req.valid.note,
    });
    if (!result?.entry) throw conflict('INSUFFICIENT_BALANCE', 'O ajuste deixaria o saldo do motorista negativo.');
    res.json({ balanceCents: result.balanceCents, entry: result.entry });
  },

  /**
   * Dá o crédito de boas-vindas a todos os motoristas aprovados que ainda não receberam
   * (útil ao ligar a cobrança com motoristas já cadastrados).
   */
  async welcomeExisting(req, res) {
    if (!billingConfig(req.tenant).welcomeCreditCents) {
      throw badRequest('WELCOME_DISABLED', 'Defina o valor do crédito de boas-vindas nas configurações antes.');
    }
    const drivers = await Driver.find({ tenantId: req.tenant._id, status: 'approved', 'wallet.welcomeGrantedAt': { $exists: false } }).select('_id');
    let granted = 0;
    for (const driver of drivers) {
      if (await grantWelcomeCredit({ tenant: req.tenant, driverId: driver._id, adminId: req.user._id })) granted += 1;
    }
    res.json({ granted });
  },
};
