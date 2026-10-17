import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Código de verificação / recuperação de senha (guardado só como hash). */
export const codeSchema = new Schema(
  {
    codeHash: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 },
    requestedAt: Date,
  },
  { _id: false },
);

/** Arquivo guardado (avatar ou documento). Nunca expomos `key` ao app. */
export const assetSchema = new Schema(
  {
    provider: { type: String, enum: ['local', 'cloudinary'] },
    key: String,
    url: String, // só para arquivos públicos (avatar)
    resourceType: String, // cloudinary
    deliveryType: String, // cloudinary
    format: String,
    mimetype: String,
    uploadedAt: Date,
  },
  { _id: false },
);

/** Campos comuns a passageiro e motorista. */
export function accountFields() {
  return {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: assetSchema, default: undefined },
    emailVerified: { type: Boolean, default: false },
    verification: { type: codeSchema, select: false, default: undefined },
    passwordReset: { type: codeSchema, select: false, default: undefined },
    pushToken: { type: String, trim: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  };
}

/** Limpa o que nunca pode sair na resposta da API. */
export function baseTransform(_doc, ret) {
  ret.id = String(ret._id);
  ret.avatarUrl = ret.avatar?.url ?? null;
  delete ret._id;
  delete ret.__v;
  delete ret.avatar;
  delete ret.passwordHash;
  delete ret.verification;
  delete ret.passwordReset;
  delete ret.tokenVersion;
  return ret;
}
