import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Mensagem do chat de uma corrida. Só é criada enquanto a corrida tem motorista e está rolando. */
const messageSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    rideId: { type: Schema.Types.ObjectId, ref: 'Ride', required: true },
    authorRole: { type: String, enum: ['passenger', 'driver'], required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ rideId: 1, createdAt: 1 });

messageSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.tenantId;
    return ret;
  },
});

export const Message = mongoose.models.Message ?? mongoose.model('Message', messageSchema);
