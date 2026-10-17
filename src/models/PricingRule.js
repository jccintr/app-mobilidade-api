import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Versões das regras de tarifa de uma operadora. Só uma fica ativa por vez. */
const pricingRuleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    version: { type: Number, required: true },
    active: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 300 },
    config: { type: Schema.Types.Mixed, required: true }, // validado por pricing/schema.js
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true },
);

pricingRuleSchema.index({ tenantId: 1, version: 1 }, { unique: true });
pricingRuleSchema.index({ tenantId: 1, active: 1 });

pricingRuleSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const PricingRule = mongoose.models.PricingRule ?? mongoose.model('PricingRule', pricingRuleSchema);
