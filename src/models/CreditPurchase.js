import mongoose from 'mongoose';
import { assetSchema } from './accountShared.js';

const { Schema } = mongoose;

/**
 * Compra de créditos (mesmo fluxo do Delivroo Express): o motorista escolhe um pacote, o sistema gera
 * o Pix na chave da operadora, o motorista paga e toca em "Já paguei", e o admin confere e confirma.
 *
 * status:
 *  pending    aguardando pagamento (Pix gerado). Expira em PURCHASE_TTL_DAYS se ninguém informar o pagamento.
 *  informed   o motorista disse que pagou — aguardando conferência do admin
 *  confirmed  admin confirmou — os créditos já entraram no saldo
 *  rejected   admin recusou (não achou o pagamento etc.) — tem motivo
 *  cancelled  o motorista desistiu antes de pagar
 *  expired    passou do prazo sem "Já paguei"
 *
 * Os créditos SÓ entram quando o admin confirma. O "Já paguei" apenas avisa a operadora.
 */
export const PURCHASE_STATUSES = ['pending', 'informed', 'confirmed', 'rejected', 'cancelled', 'expired'];
export const PURCHASE_TTL_DAYS = 3;

const creditPurchaseSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    // Código curto e legível (ex.: C7K3F9Q) usado pelo motorista e pelo admin. Vai como identificador (txid) no Pix.
    code: { type: String, required: true, unique: true },
    // Cópia do pacote no momento da compra (não muda se o pacote for editado ou excluído depois).
    package: {
      packageId: { type: Schema.Types.ObjectId, default: null },
      name: { type: String, required: true },
      priceCents: { type: Number, required: true },
      creditCents: { type: Number, required: true },
    },
    status: { type: String, enum: PURCHASE_STATUSES, default: 'pending' },
    // true enquanto pending/informed: o índice abaixo garante no máximo UMA compra em aberto por motorista.
    open: { type: Boolean, default: true },
    pixPayload: { type: String, required: true }, // "copia e cola" (o QR é desenhado a partir dele)
    expiresAt: { type: Date, required: true },

    informedAt: Date,
    payerNote: { type: String, trim: true, maxlength: 200 },
    receipt: { type: assetSchema, default: undefined }, // comprovante (privado, opcional)
    confirmedAt: Date,
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    rejectionReason: { type: String, trim: true, maxlength: 200 },
    cancelledAt: Date,
    expiredAt: Date,
  },
  { timestamps: true },
);

creditPurchaseSchema.index(
  { tenantId: 1, driverId: 1 },
  { unique: true, partialFilterExpression: { open: true }, name: 'driver_open_purchase' },
);
creditPurchaseSchema.index({ tenantId: 1, driverId: 1, createdAt: -1 });
creditPurchaseSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

creditPurchaseSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    ret.hasReceipt = Boolean(ret.receipt?.key);
    delete ret._id;
    delete ret.__v;
    delete ret.tenantId;
    delete ret.open;
    delete ret.receipt;
    return ret;
  },
});

export const CreditPurchase = mongoose.models.CreditPurchase ?? mongoose.model('CreditPurchase', creditPurchaseSchema);
