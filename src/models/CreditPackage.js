import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Pacote de créditos que o motorista compra via Pix. Criado e gerenciado pelo admin da operadora.
 * `creditCents` pode ser maior que `priceCents` (bônus: paga R$ 100, recebe R$ 110 de crédito).
 *
 * Excluir é seguro: cada compra guarda uma cópia do pacote no momento da compra (ver CreditPurchase).
 */
const creditPackageSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    priceCents: { type: Number, required: true, min: 100, max: 10_000_00 },
    creditCents: { type: Number, required: true, min: 100, max: 20_000_00 },
    active: { type: Boolean, default: true }, // desabilitado não aparece para o motorista
  },
  { timestamps: true },
);

creditPackageSchema.index({ tenantId: 1, priceCents: 1 });

creditPackageSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    ret.bonusCents = Math.max(0, ret.creditCents - ret.priceCents);
    delete ret._id;
    delete ret.__v;
    delete ret.tenantId;
    return ret;
  },
});

export const CreditPackage = mongoose.models.CreditPackage ?? mongoose.model('CreditPackage', creditPackageSchema);
