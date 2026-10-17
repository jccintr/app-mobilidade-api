import { Message } from '../models/Message.js';
import { Ride } from '../models/Ride.js';
import { emit, rooms } from '../realtime/emitter.js';
import { forbidden, notFound } from '../utils/errors.js';
import { canChat } from './stateMachine.js';

async function findParticipantRide({ tenantId, rideId, role, userId }) {
  const filter = { _id: rideId, tenantId };
  if (role === 'passenger') filter.passengerId = userId;
  else filter.driverId = userId;
  const ride = await Ride.findOne(filter).select('tenantId passengerId driverId status');
  // 404 também para quem não participa: não revela que a corrida existe.
  if (!ride) throw notFound('RIDE_NOT_FOUND', 'Corrida não encontrada.');
  return ride;
}

/**
 * REGRA DO PRODUTO: o chat só existe depois que um motorista aceita a corrida e enquanto ela está rolando.
 * Esta checagem é feita aqui, no servidor, para REST e Socket.IO. O app só esconde o botão.
 */
export async function sendMessage({ tenantId, rideId, role, userId, text }) {
  const ride = await findParticipantRide({ tenantId, rideId, role, userId });
  if (!canChat(ride.status)) {
    throw forbidden(
      'CHAT_NOT_AVAILABLE',
      'O chat só fica disponível depois que um motorista aceita a corrida e até ela terminar.',
    );
  }

  const message = await Message.create({ tenantId, rideId: ride._id, authorRole: role, authorId: userId, text });
  const payload = message.toJSON();
  emit(rooms.passenger(tenantId, ride.passengerId), 'chat:message', payload);
  emit(rooms.driver(tenantId, ride.driverId), 'chat:message', payload);
  return payload;
}

/** Histórico: os dois participantes podem ler mesmo depois que a corrida termina (somente leitura). */
export async function listMessages({ tenantId, rideId, role, userId, limit = 50, before }) {
  const ride = await findParticipantRide({ tenantId, rideId, role, userId });
  const filter = { rideId: ride._id };
  if (before) filter.createdAt = { $lt: before };
  const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit);
  return { data: messages.reverse().map((message) => message.toJSON()), chatOpen: canChat(ride.status) };
}
