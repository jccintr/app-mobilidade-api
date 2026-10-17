import { env } from '../config/env.js';
import { Driver } from '../models/Driver.js';
import { Ride } from '../models/Ride.js';
import { emit, rooms } from '../realtime/emitter.js';
import { emitAdminRide } from './notify.js';
import { serializeRide } from './serialize.js';
import { sendPush } from '../services/push.js';

/**
 * Despacho sequencial: oferece a corrida a UM motorista por vez (o mais próximo disponível).
 * Se ele recusar ou o tempo acabar, passa para o próximo, até MAX_OFFERS ou o fim da janela de busca.
 *
 * Funciona em uma única instância da API (timers em memória). O "sweeper" abaixo recupera o fluxo
 * após reinício. Para várias instâncias, a troca de estado já é atômica no banco, mas o ideal é
 * mover os timers para uma fila (ex.: Redis) — ver README.
 */

const timers = new Map();

function scheduleCheck(rideId, delayMs) {
  const key = String(rideId);
  clearTimeout(timers.get(key));
  const timer = setTimeout(() => {
    timers.delete(key);
    dispatchNext(rideId).catch((error) => console.error('Falha no despacho:', error));
  }, delayMs);
  timer.unref?.();
  timers.set(key, timer);
}

/** Cancela os timers pendentes (encerramento do servidor e testes). */
export function clearDispatchTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/** Motoristas que não podem receber oferta agora: em corrida ou com outra oferta pendente. */
async function busyDriverIds(tenantId, now) {
  const [inRide, withOffer] = await Promise.all([
    Ride.distinct('activeDriverId', { tenantId, activeDriverId: { $ne: null } }),
    Ride.aggregate([
      { $match: { tenantId, status: 'requested' } },
      { $unwind: '$offers' },
      { $match: { 'offers.status': 'pending', 'offers.expiresAt': { $gt: now } } },
      { $group: { _id: '$offers.driverId' } },
    ]),
  ]);
  return [...inRide, ...withOffer.map((row) => row._id)];
}

async function findCandidate(ride, now) {
  const busy = await busyDriverIds(ride.tenantId, now);
  const alreadyOffered = ride.offers.map((offer) => offer.driverId);
  const freshAfter = new Date(now.getTime() - env.rides.locationMaxAgeSeconds * 1000);

  return Driver.findOne({
    tenantId: ride.tenantId,
    status: 'approved',
    online: true,
    'vehicle.type': ride.vehicleType,
    locationUpdatedAt: { $gte: freshAfter },
    _id: { $nin: [...busy, ...alreadyOffered] },
    location: { $near: { $geometry: ride.pickup.location, $maxDistance: env.rides.dispatchRadiusMeters } },
  }).select('_id');
}

async function closeWithoutDriver(ride) {
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, status: 'requested' },
    {
      $set: { status: 'no_driver', cancelledAt: new Date(), cancelledBy: 'system' },
      $unset: { activePassengerId: '', activeDriverId: '' },
    },
    { returnDocument: 'after' },
  );
  if (updated) {
    emit(rooms.passenger(updated.tenantId, updated.passengerId), 'ride:update', serializeRide(updated, 'passenger'));
    emitAdminRide(updated);
  }
}

/** Idempotente: pode ser chamada a qualquer momento (pedido, recusa, timer, sweeper). */
export async function dispatchNext(rideId) {
  const now = new Date();
  let ride = await Ride.findById(rideId);
  if (!ride || ride.status !== 'requested') return;

  // Ainda há uma oferta valendo: só garante que alguém vai olhar quando ela vencer.
  const pending = ride.offers.find((offer) => offer.status === 'pending' && offer.expiresAt > now);
  if (pending) {
    scheduleCheck(rideId, pending.expiresAt.getTime() - now.getTime() + 200);
    return;
  }

  // Ofertas vencidas viram "expired".
  await Ride.updateOne(
    { _id: ride._id },
    { $set: { 'offers.$[offer].status': 'expired' } },
    { arrayFilters: [{ 'offer.status': 'pending', 'offer.expiresAt': { $lte: now } }] },
  );
  ride = await Ride.findById(rideId);
  if (!ride || ride.status !== 'requested') return;

  if (ride.offers.length >= env.rides.maxOffers) return closeWithoutDriver(ride);

  const candidate = await findCandidate(ride, now);
  if (!candidate) {
    const waited = now.getTime() - ride.createdAt.getTime();
    if (waited >= env.rides.searchSeconds * 1000) return closeWithoutDriver(ride);
    return; // o sweeper tenta de novo em alguns segundos (pode aparecer motorista online)
  }

  const expiresAt = new Date(now.getTime() + env.rides.offerSeconds * 1000);
  const offered = await Ride.findOneAndUpdate(
    { _id: ride._id, status: 'requested', offers: { $not: { $elemMatch: { status: 'pending' } } } },
    { $push: { offers: { driverId: candidate._id, offeredAt: now, expiresAt, status: 'pending' } } },
    { returnDocument: 'after' },
  );
  if (!offered) return; // outra execução se adiantou

  emit(rooms.driver(offered.tenantId, candidate._id), 'ride:offer', {
    ride: serializeRide(offered, 'driver'),
    expiresAt,
    secondsToAnswer: env.rides.offerSeconds,
  });
  // Se o app estiver fechado/em segundo plano, o push avisa da oferta (melhor esforço).
  Driver.findById(candidate._id)
    .select('pushToken')
    .lean()
    .then((driver) =>
      sendPush(driver?.pushToken, {
        title: 'Nova corrida!',
        body: `${offered.pickup.address || 'Corrida disponível'} · toque para responder`,
        data: { type: 'ride:offer', rideId: String(offered._id) },
      }),
    )
    .catch(() => {});
  scheduleCheck(rideId, env.rides.offerSeconds * 1000 + 200);
}

/** Retoma corridas "requested" (após reinício do servidor ou quando ainda não havia motorista). */
export function startDispatchSweeper({ intervalMs = 5000 } = {}) {
  const timer = setInterval(async () => {
    try {
      const rides = await Ride.find({ status: 'requested' }).select('_id').limit(200).lean();
      for (const { _id } of rides) await dispatchNext(_id);
    } catch (error) {
      console.error('Falha no sweeper de despacho:', error);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
