import mongoose from 'mongoose';
import { RIDE_STATUSES } from '../rides/stateMachine.js';

const { Schema } = mongoose;

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  { _id: false },
);

const placeSchema = new Schema(
  {
    address: { type: String, trim: true, maxlength: 200 },
    location: { type: pointSchema, required: true },
  },
  { _id: false },
);

const offerSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    offeredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' },
  },
  { _id: false },
);

const ratingSchema = new Schema(
  {
    stars: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 300 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const rideSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    passengerId: { type: Schema.Types.ObjectId, ref: 'Passenger', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    status: { type: String, enum: RIDE_STATUSES, default: 'requested' },
    // Presentes só enquanto a corrida está viva. O índice único parcial abaixo garante, no banco,
    // que um passageiro (ou motorista) não tenha duas corridas ao mesmo tempo, mesmo com pedidos simultâneos.
    activePassengerId: { type: Schema.Types.ObjectId, default: undefined },
    activeDriverId: { type: Schema.Types.ObjectId, default: undefined },
    vehicleType: { type: String, enum: ['car'], required: true },
    paymentMethod: { type: String, enum: ['cash', 'pix_direct'], default: 'cash' },

    pickup: { type: placeSchema, required: true },
    dropoff: { type: placeSchema, required: true },

    // Preço combinado no pedido. A regra usada fica registrada para explicar o valor depois.
    route: { distanceKm: Number, durationMin: Number },
    ruleId: { type: Schema.Types.ObjectId, ref: 'PricingRule', required: true },
    ruleVersion: Number,
    fareInput: Schema.Types.Mixed,
    estimate: Schema.Types.Mixed, // saída completa do motor (linhas, ajustes)
    finalFare: Schema.Types.Mixed, // recalculada ao finalizar, se houve espera/pedágio
    totalCents: { type: Number, required: true }, // valor a cobrar (estimado ou final)

    // Dados de exibição congelados (evita consultas e mantém o histórico fiel).
    passengerInfo: { name: String, avatarUrl: String, ratingAvg: Number },
    driverInfo: {
      name: String,
      avatarUrl: String,
      ratingAvg: Number,
      vehicle: { type: { type: String }, brand: String, model: String, color: String, plate: String },
    },

    offers: { type: [offerSchema], default: [] },

    acceptedAt: Date,
    arrivedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: String, enum: ['passenger', 'driver', 'system'] },
    cancelReason: { type: String, trim: true, maxlength: 200 },

    passengerRating: { type: ratingSchema, default: undefined }, // nota do passageiro para o motorista
    driverRating: { type: ratingSchema, default: undefined }, // nota do motorista para o passageiro
  },
  { timestamps: true },
);

rideSchema.index({ tenantId: 1, passengerId: 1, createdAt: -1 });
rideSchema.index({ tenantId: 1, driverId: 1, createdAt: -1 });
rideSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
rideSchema.index({ status: 1, 'offers.expiresAt': 1 });
rideSchema.index(
  { activePassengerId: 1 },
  { unique: true, partialFilterExpression: { activePassengerId: { $type: 'objectId' } } },
);
rideSchema.index(
  { activeDriverId: 1 },
  { unique: true, partialFilterExpression: { activeDriverId: { $type: 'objectId' } } },
);

rideSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.fareInput;
    delete ret.activePassengerId;
    delete ret.activeDriverId;
    return ret;
  },
});

export const Ride = mongoose.models.Ride ?? mongoose.model('Ride', rideSchema);
