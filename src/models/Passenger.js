import mongoose from 'mongoose';
import { accountFields, baseTransform } from './accountShared.js';

const { Schema } = mongoose;

const passengerSchema = new Schema(
  {
    ...accountFields(),
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

passengerSchema.index({ tenantId: 1, email: 1 }, { unique: true });

passengerSchema.set('toJSON', { transform: baseTransform });

export const Passenger = mongoose.models.Passenger ?? mongoose.model('Passenger', passengerSchema);
