import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Administradores:
 *  - super_admin: você (dono da plataforma), sem tenantId.
 *  - operator_admin: administrador de uma operadora, preso ao tenantId dela.
 */
const adminUserSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    role: { type: String, enum: ['super_admin', 'operator_admin'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

adminUserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

adminUserSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    return ret;
  },
});

export const AdminUser = mongoose.models.AdminUser ?? mongoose.model('AdminUser', adminUserSchema);
