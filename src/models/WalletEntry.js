import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Extrato dos créditos do motorista. Toda entrada e saída do saldo fica registrada aqui,
 * com o saldo logo depois da movimentação — assim qualquer saldo pode ser explicado.
 *
 * type:
 *  purchase     entrada: compra de créditos confirmada pelo admin
 *  welcome      entrada: crédito de boas-vindas (uma vez por motorista)
 *  ride_fee     saída: taxa da operadora, descontada quando o motorista aceita a corrida
 *  ride_refund  entrada: taxa devolvida porque o PASSAGEIRO cancelou depois do aceite
 *               (se o motorista cancelar, a taxa não volta)
 *  adjustment   entrada ou saída manual feita pelo admin (cortesia, correção)
 *
 * Créditos não expiram e não são reembolsados em dinheiro.
 */
export const WALLET_ENTRY_TYPES = ['purchase', 'welcome', 'ride_fee', 'ride_refund', 'adjustment'];

const walletEntrySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    type: { type: String, enum: WALLET_ENTRY_TYPES, required: true },
    amountCents: { type: Number, required: true }, // positivo entra, negativo sai
    balanceAfterCents: { type: Number, required: true, min: 0 },
    rideId: { type: Schema.Types.ObjectId, ref: 'Ride', default: undefined },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'CreditPurchase', default: undefined },
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: undefined },
    note: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

walletEntrySchema.index({ tenantId: 1, driverId: 1, createdAt: -1 });
walletEntrySchema.index({ tenantId: 1, type: 1, createdAt: -1 });
// Garantias no banco contra lançamento repetido (requisição duplicada, clique duplo, corrida de requisições):
// cada compra credita uma vez; cada corrida cobra (e devolve) uma vez; boas-vindas só uma vez por motorista.
walletEntrySchema.index({ purchaseId: 1 }, { unique: true, partialFilterExpression: { type: 'purchase' } });
walletEntrySchema.index({ rideId: 1, type: 1 }, { unique: true, partialFilterExpression: { rideId: { $exists: true } } });
walletEntrySchema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { type: 'welcome' }, name: 'welcome_once' });

walletEntrySchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.tenantId;
    return ret;
  },
});

export const WalletEntry = mongoose.models.WalletEntry ?? mongoose.model('WalletEntry', walletEntrySchema);
