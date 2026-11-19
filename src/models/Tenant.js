import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Uma operadora (empresa/cooperativa) que usa a plataforma. Tudo é isolado por tenantId. */
const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
    },
    active: { type: Boolean, default: true },
    timezone: { type: String, default: 'America/Sao_Paulo' },
    brand: {
      displayName: { type: String, trim: true, maxlength: 60 },
      primaryColor: { type: String, default: '#111827', match: /^#[0-9a-fA-F]{6}$/ },
      logoUrl: { type: String, trim: true },
      logoAsset: { provider: String, key: String }, // arquivo enviado pelo painel (para poder trocar/remover)
    },
    // Onde o mapa abre (painel e apps). Vazio = cada tela usa o seu padrão.
    map: {
      center: { lat: { type: Number, min: -90, max: 90 }, lng: { type: Number, min: -180, max: 180 } },
      zoom: { type: Number, min: 3, max: 19, default: 13 },
    },
    cities: [
      new Schema(
        {
          ibgeCode: { type: String, trim: true },
          name: { type: String, trim: true, required: true },
          uf: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2, required: true },
        },
        { _id: false },
      ),
    ],
    settings: {
      requireDriverApproval: { type: Boolean, default: true },
      requireEmailVerification: { type: Boolean, default: true },
    },
    // Cobrança dos motoristas: taxa por corrida paga com créditos pré-pagos, comprados via Pix na chave da operadora.
    // Taxa fixa e percentual zerados = cobrança desligada (ninguém precisa de saldo).
    billing: {
      feeFixedCents: { type: Number, default: 0, min: 0 },
      feePercent: { type: Number, default: 0, min: 0, max: 100 },
      lowBalanceCents: { type: Number, default: 0, min: 0 }, // avisa o motorista quando o saldo cai abaixo disto
      welcomeCreditCents: { type: Number, default: 0, min: 0 }, // crédito dado uma vez, na aprovação do cadastro
      pix: {
        key: { type: String, trim: true }, // já normalizada (utils/pix.js)
        keyType: { type: String, enum: ['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'RANDOM'] },
        receiverName: { type: String, trim: true, maxlength: 60 },
        city: { type: String, trim: true, maxlength: 40 },
      },
      notifyEmail: { type: String, trim: true, lowercase: true, maxlength: 120 }, // recebe o aviso de "Já paguei"
    },
    // Condições que a operadora liga/desliga no painel e que entram no cálculo da tarifa.
    conditions: {
      rain: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

tenantSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Tenant = mongoose.models.Tenant ?? mongoose.model('Tenant', tenantSchema);
