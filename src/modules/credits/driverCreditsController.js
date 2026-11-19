import { AdminUser } from '../../models/AdminUser.js';
import { CreditPackage } from '../../models/CreditPackage.js';
import { CreditPurchase, PURCHASE_TTL_DAYS } from '../../models/CreditPurchase.js';
import { WalletEntry } from '../../models/WalletEntry.js';
import { billingConfig, isBillingEnabled } from '../../billing/fee.js';
import { emit, rooms } from '../../realtime/emitter.js';
import { sendCreditInformedEmail } from '../../services/mailer.js';
import { storage } from '../../services/storage/index.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { EXT_BY_TYPE, MIME_BY_TYPE, sniffFileType } from '../../utils/fileType.js';
import {
  expireStalePurchases,
  generatePurchaseCode,
  pixPayloadFor,
  serializePurchase,
  tenantPix,
} from './purchases.js';

/**
 * Créditos do motorista (usado pela página web de compra de créditos e pelo app).
 * Fluxo da compra: escolher pacote → compra "pending" com QR Pix → "Já paguei" ("informed")
 * → admin confirma ("confirmed") e o crédito entra no saldo.
 */

const isDuplicateKey = (error) => error?.code === 11000;
const DAY_MS = 24 * 60 * 60 * 1000;
const scope = (req) => ({ tenantId: req.tenant._id, driverId: req.user._id });

/** Resumo da cobrança que o motorista precisa saber (sem dados internos da operadora). */
function billingView(tenant) {
  const config = billingConfig(tenant);
  return {
    enabled: isBillingEnabled(config),
    feeFixedCents: config.feeFixedCents,
    feePercent: config.feePercent,
    lowBalanceCents: config.lowBalanceCents,
    pixReady: Boolean(tenantPix(tenant)),
  };
}

/** Quem recebe o aviso de "Já paguei": o e-mail configurado ou, sem ele, os administradores da operadora. */
async function noticeRecipients(tenant) {
  if (tenant.billing?.notifyEmail) return [tenant.billing.notifyEmail];
  const admins = await AdminUser.find({ tenantId: tenant._id, role: 'operator_admin', active: true }).select('email').lean();
  return admins.map((admin) => admin.email);
}

export const driverCreditsController = {
  /** Saldo, regras de cobrança e a compra em aberto (se houver). */
  async wallet(req, res) {
    await expireStalePurchases(scope(req));
    const open = await CreditPurchase.findOne({ ...scope(req), open: true });
    res.json({
      balanceCents: req.user.wallet?.balanceCents ?? 0,
      billing: billingView(req.tenant),
      openPurchase: open ? await serializePurchase(open, { withQr: true }) : null,
    });
  },

  /** Extrato, mais recente primeiro. */
  async entries(req, res) {
    const { page, limit } = req.valid;
    const filter = scope(req);
    const [data, total] = await Promise.all([
      WalletEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      WalletEntry.countDocuments(filter),
    ]);
    res.json({ data, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  },

  async packages(req, res) {
    const packages = await CreditPackage.find({ tenantId: req.tenant._id, active: true }).sort({ priceCents: 1 });
    res.json({ data: packages, billing: billingView(req.tenant) });
  },

  async listPurchases(req, res) {
    const { page, limit } = req.valid;
    await expireStalePurchases(scope(req));
    const filter = scope(req);
    const [purchases, total] = await Promise.all([
      CreditPurchase.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      CreditPurchase.countDocuments(filter),
    ]);
    res.json({
      data: await Promise.all(purchases.map((purchase) => serializePurchase(purchase))),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  },

  async getPurchase(req, res) {
    await expireStalePurchases(scope(req));
    const purchase = await CreditPurchase.findOne({ ...scope(req), _id: req.valid.id });
    if (!purchase) throw notFound('PURCHASE_NOT_FOUND', 'Compra não encontrada.');
    res.json({ purchase: await serializePurchase(purchase, { withQr: true }) });
  },

  /** Cria a compra e devolve o Pix (QR + copia e cola). Só uma compra em aberto por motorista. */
  async createPurchase(req, res) {
    const pix = tenantPix(req.tenant);
    if (!pix) {
      throw new AppError(503, 'PIX_NOT_CONFIGURED', 'A compra de créditos ainda não está disponível. Fale com a operadora.');
    }
    const pkg = await CreditPackage.findOne({ _id: req.valid.packageId, tenantId: req.tenant._id, active: true });
    if (!pkg) throw notFound('PACKAGE_NOT_FOUND', 'Pacote não encontrado ou indisponível.');

    await expireStalePurchases(scope(req));
    if (await CreditPurchase.exists({ ...scope(req), open: true })) {
      throw conflict('OPEN_PURCHASE_EXISTS', 'Você já tem uma compra em aberto. Conclua ou cancele essa compra antes de criar outra.');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePurchaseCode();
      try {
        const purchase = await CreditPurchase.create({
          ...scope(req),
          code,
          package: { packageId: pkg._id, name: pkg.name, priceCents: pkg.priceCents, creditCents: pkg.creditCents },
          pixPayload: pixPayloadFor(pix, { amountCents: pkg.priceCents, code }),
          expiresAt: new Date(Date.now() + PURCHASE_TTL_DAYS * DAY_MS),
        });
        return res.status(201).json({ purchase: await serializePurchase(purchase, { withQr: true }) });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (error.keyPattern?.driverId) {
          throw conflict('OPEN_PURCHASE_EXISTS', 'Você já tem uma compra em aberto. Conclua ou cancele essa compra antes de criar outra.');
        }
        // código repetido: sorteia outro
      }
    }
    throw new AppError(500, 'PURCHASE_FAILED', 'Não foi possível gerar a compra. Tente novamente.');
  },

  /**
   * "Já paguei": avisa a operadora (e-mail + painel em tempo real). NÃO libera saldo — só o admin confirma.
   * O comprovante (campo "receipt") é opcional e fica privado.
   */
  async inform(req, res) {
    await expireStalePurchases(scope(req));
    const current = await CreditPurchase.findOne({ ...scope(req), _id: req.valid.id });
    if (!current) throw notFound('PURCHASE_NOT_FOUND', 'Compra não encontrada.');
    if (current.status !== 'pending') {
      const messages = {
        informed: 'Você já informou este pagamento. Aguarde a confirmação.',
        confirmed: 'Esta compra já foi confirmada.',
        rejected: 'Esta compra foi recusada. Gere uma nova compra.',
        cancelled: 'Esta compra foi cancelada. Gere uma nova compra.',
        expired: 'O prazo desta compra venceu. Se você já pagou, fale com a operadora.',
      };
      throw conflict('INVALID_STATE', messages[current.status] ?? 'Esta compra não pode ser alterada.');
    }

    let receipt;
    if (req.file) {
      const kind = sniffFileType(req.file.buffer);
      if (!['jpeg', 'png', 'webp', 'pdf'].includes(kind)) {
        throw new AppError(415, 'INVALID_FILE_TYPE', 'Envie o comprovante como imagem (JPG, PNG, WEBP) ou PDF.');
      }
      receipt = await storage.save(req.file.buffer, {
        folder: `${req.tenant.slug}/drivers/${req.user._id}/receipts`,
        ext: EXT_BY_TYPE[kind],
        mimetype: MIME_BY_TYPE[kind],
        privacy: 'private',
      });
    }

    // pending → informed atômico: dois toques seguidos avisam a operadora uma vez só.
    const purchase = await CreditPurchase.findOneAndUpdate(
      { _id: current._id, status: 'pending' },
      {
        $set: {
          status: 'informed',
          informedAt: new Date(),
          ...(req.valid.payerNote ? { payerNote: req.valid.payerNote } : {}),
          ...(receipt ? { receipt } : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (!purchase) {
      if (receipt) storage.remove(receipt).catch(() => {});
      throw conflict('INVALID_STATE', 'Você já informou este pagamento. Aguarde a confirmação.');
    }

    // Avisos à operadora: falha de e-mail ou socket nunca desfaz o "Já paguei" (a compra continua na fila do painel).
    const driver = { id: String(req.user._id), name: req.user.name, email: req.user.email, phone: req.user.phone };
    emit(rooms.admin(String(req.tenant._id)), 'credit:informed', {
      purchase: { id: String(purchase._id), code: purchase.code, package: purchase.package, informedAt: purchase.informedAt },
      driver,
    });
    noticeRecipients(req.tenant)
      .then((to) => (to.length ? sendCreditInformedEmail({ to: to.join(','), tenant: req.tenant, driver, purchase }) : null))
      .catch((error) => console.error('[mailer] falha ao avisar a operadora do pagamento informado:', error?.message ?? error));

    res.json({ purchase: await serializePurchase(purchase, { withQr: true }) });
  },

  /** O motorista desiste de uma compra que ainda não pagou. */
  async cancelPurchase(req, res) {
    const purchase = await CreditPurchase.findOneAndUpdate(
      { ...scope(req), _id: req.valid.id, status: 'pending' },
      { $set: { status: 'cancelled', open: false, cancelledAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!purchase) {
      const exists = await CreditPurchase.exists({ ...scope(req), _id: req.valid.id });
      if (!exists) throw notFound('PURCHASE_NOT_FOUND', 'Compra não encontrada.');
      throw conflict('INVALID_STATE', 'Só é possível cancelar uma compra que ainda não foi paga. Se você já pagou, aguarde a confirmação.');
    }
    res.json({ purchase: await serializePurchase(purchase) });
  },
};
