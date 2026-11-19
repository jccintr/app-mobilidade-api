import mongoose from 'mongoose';
import { accountFields, assetSchema, baseTransform } from './accountShared.js';

const { Schema } = mongoose;

export const DRIVER_STATUSES = ['incomplete', 'pending_approval', 'approved', 'rejected', 'blocked'];
export const DOCUMENT_TYPES = ['cnh', 'selfie', 'crlv'];
export const VEHICLE_TYPES = ['car'];

const driverSchema = new Schema(
  {
    ...accountFields(),
    status: { type: String, enum: DRIVER_STATUSES, default: 'incomplete' },
    statusBeforeBlock: { type: String, enum: DRIVER_STATUSES },
    rejectionReason: { type: String, trim: true, maxlength: 300 },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },

    vehicle: {
      type: new Schema(
        {
          type: { type: String, enum: VEHICLE_TYPES },
          brand: { type: String, trim: true },
          model: { type: String, trim: true },
          color: { type: String, trim: true },
          plate: { type: String, trim: true, uppercase: true },
          year: Number,
        },
        { _id: false },
      ),
      default: undefined,
    },

    // Documentos privados: só o admin da operadora acessa.
    documents: {
      cnh: { type: assetSchema, default: undefined },
      selfie: { type: assetSchema, default: undefined },
      crlv: { type: assetSchema, default: undefined },
    },

    // Usados nas próximas etapas (despacho).
    online: { type: Boolean, default: false },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined }, // [longitude, latitude]
    },
    locationUpdatedAt: Date,
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // Créditos pré-pagos: a taxa da operadora de cada corrida sai daqui, no aceite. Movimentações em WalletEntry.
    wallet: {
      balanceCents: { type: Number, default: 0, min: 0 },
      welcomeGrantedAt: Date,
    },
  },
  { timestamps: true },
);

driverSchema.index({ tenantId: 1, email: 1 }, { unique: true });
// Placa única por operadora (só quando a placa existe).
driverSchema.index(
  { tenantId: 1, 'vehicle.plate': 1 },
  { unique: true, partialFilterExpression: { 'vehicle.plate': { $type: 'string' } } },
);
driverSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
driverSchema.index({ location: '2dsphere' }, { sparse: true });

driverSchema.set('toJSON', {
  transform(doc, ret) {
    // Em vez dos dados do arquivo, mostramos só se o documento foi enviado.
    const summary = {};
    for (const type of DOCUMENT_TYPES) {
      const asset = ret.documents?.[type];
      summary[type] = asset?.key ? { uploaded: true, uploadedAt: asset.uploadedAt, mimetype: asset.mimetype } : { uploaded: false };
    }
    ret.documents = summary;
    return baseTransform(doc, ret);
  },
});

export const Driver = mongoose.models.Driver ?? mongoose.model('Driver', driverSchema);
