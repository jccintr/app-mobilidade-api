import { Driver } from '../models/Driver.js';
import { Passenger } from '../models/Passenger.js';
import { PricingRule } from '../models/PricingRule.js';
import { Ride } from '../models/Ride.js';
import { calculateFare } from '../pricing/engine.js';
import { emit, rooms } from '../realtime/emitter.js';
import { AppError, conflict, forbidden, notFound } from '../utils/errors.js';
import { toPoint } from '../utils/geo.js';
import { dispatchNext } from './dispatch.js';
import { forgetDriverRide } from './driverPresence.js';
import { emitAdminRide } from './notify.js';
import { buildQuotes } from './quote.js';
import { serializeRide } from './serialize.js';
import { canRate, checkTransition, isFinal } from './stateMachine.js';

const isDuplicateKey = (error) => error?.code === 11000;

const MESSAGES = {
  INVALID_STATE: 'Esta ação não é possível no estado atual da corrida.',
  ACTOR_NOT_ALLOWED: 'Você não pode fazer esta ação.',
};

/** Avisa quem participa da corrida que algo mudou. */
export function notifyRide(ride) {
  const tenantId = String(ride.tenantId);
  emitAdminRide(ride);
  emit(rooms.passenger(tenantId, ride.passengerId), 'ride:update', serializeRide(ride, 'passenger'));
  if (ride.driverId) {
    emit(rooms.driver(tenantId, ride.driverId), 'ride:update', serializeRide(ride, 'driver'));
    forgetDriverRide(ride.driverId); // a posição ao vivo passa a seguir (ou deixa de seguir) esta corrida
  }
}

/** Corrida que o usuário pode ver: dele (passageiro) ou atribuída a ele (motorista). */
export async function findRideFor({ tenantId, rideId, role, userId }) {
  const filter = { _id: rideId, tenantId };
  if (role === 'passenger') filter.passengerId = userId;
  else {
    filter.$or = [{ driverId: userId }, { offers: { $elemMatch: { driverId: userId, status: 'pending' } } }];
  }
  const ride = await Ride.findOne(filter);
  if (!ride) throw notFound('RIDE_NOT_FOUND', 'Corrida não encontrada.');
  return ride;
}

// ---------------------------------------------------------------- pedido

export async function createRide({ tenant, passenger, body }) {
  const { rule, route, fares, inputs } = await buildQuotes({
    tenant,
    pickup: body.pickup,
    dropoff: body.dropoff,
    vehicleTypes: [body.vehicleType],
  });
  const fare = fares[body.vehicleType];
  if (!fare) throw new AppError(400, 'VEHICLE_NOT_SUPPORTED', 'Esta operadora não atende esse tipo de veículo.');

  const info = passenger.toJSON();
  let ride;
  try {
    ride = await Ride.create({
      tenantId: tenant._id,
      passengerId: passenger._id,
      activePassengerId: passenger._id,
      vehicleType: body.vehicleType,
      paymentMethod: body.paymentMethod,
      pickup: { address: body.pickup.address, location: toPoint(body.pickup) },
      dropoff: { address: body.dropoff.address, location: toPoint(body.dropoff) },
      route,
      ruleId: rule._id,
      ruleVersion: rule.version,
      fareInput: inputs[body.vehicleType],
      estimate: fare,
      totalCents: fare.totalCents,
      passengerInfo: { name: info.name, avatarUrl: info.avatarUrl, ratingAvg: passenger.ratingAvg ?? 0 },
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw conflict('ACTIVE_RIDE_EXISTS', 'Você já tem uma corrida em andamento.');
    }
    throw error;
  }

  // Começa a procurar motorista sem bloquear a resposta ao passageiro.
  dispatchNext(ride._id).catch((error) => console.error('Falha no despacho:', error));
  return ride;
}

// ------------------------------------------------------------ transições

const FINAL_UNSET = { activePassengerId: '', activeDriverId: '' };

/**
 * Aplica uma ação (arrive/start/finish/cancel) com checagem de dono, de estado e de concorrência.
 * O update é condicional ao estado lido: se outra requisição mudou a corrida no meio, não aplica.
 */
export async function transition({ tenantId, rideId, action, actor, userId, reason, finish }) {
  const filter = { _id: rideId, tenantId };
  if (actor === 'passenger') filter.passengerId = userId;
  else filter.driverId = userId;

  const ride = await Ride.findOne(filter);
  if (!ride) throw notFound('RIDE_NOT_FOUND', 'Corrida não encontrada.');

  const check = checkTransition(action, ride.status, actor);
  if (!check.ok) throw conflict(check.reason, MESSAGES[check.reason] ?? 'Ação inválida.');

  const now = new Date();
  const set = { status: check.to };
  if (action === 'arrive') set.arrivedAt = now;
  if (action === 'start') set.startedAt = now;
  if (action === 'finish') {
    set.completedAt = now;
    if (finish && (finish.waitMinutes > 0 || finish.tolls > 0)) {
      const rule = await PricingRule.findById(ride.ruleId);
      if (rule) {
        const fare = calculateFare(rule.config, {
          ...ride.fareInput,
          waitMinutes: finish.waitMinutes,
          tolls: finish.tolls,
        });
        set.finalFare = fare;
        set.totalCents = fare.totalCents;
      }
    }
  }
  if (action === 'cancel') {
    set.cancelledAt = now;
    set.cancelledBy = actor;
    if (reason) set.cancelReason = reason;
  }

  const update = { $set: set };
  if (isFinal(check.to)) update.$unset = FINAL_UNSET;

  const updated = await Ride.findOneAndUpdate({ ...filter, status: ride.status }, update, { returnDocument: 'after' });
  if (!updated) throw conflict('RIDE_CHANGED', 'A corrida mudou. Atualize e tente de novo.');

  notifyRide(updated);
  return updated;
}

// ---------------------------------------------------- aceitar e recusar

export async function acceptRide({ tenantId, rideId, driver }) {
  const now = new Date();
  const info = driver.toJSON();
  let updated;
  try {
    updated = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        tenantId,
        status: 'requested',
        driverId: null,
        offers: { $elemMatch: { driverId: driver._id, status: 'pending', expiresAt: { $gt: now } } },
      },
      {
        $set: {
          status: 'accepted',
          driverId: driver._id,
          activeDriverId: driver._id,
          acceptedAt: now,
          'offers.$[offer].status': 'accepted',
          driverInfo: {
            name: info.name,
            avatarUrl: info.avatarUrl,
            ratingAvg: driver.ratingAvg ?? 0,
            vehicle: info.vehicle,
          },
        },
      },
      { returnDocument: 'after', arrayFilters: [{ 'offer.driverId': driver._id, 'offer.status': 'pending' }] },
    );
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('DRIVER_BUSY', 'Você já está em uma corrida.');
    throw error;
  }

  if (!updated) {
    const exists = await Ride.exists({ _id: rideId, tenantId });
    if (!exists) throw notFound('RIDE_NOT_FOUND', 'Corrida não encontrada.');
    throw conflict('OFFER_EXPIRED', 'Esta corrida não está mais disponível.');
  }
  notifyRide(updated);
  return updated;
}

export async function declineRide({ tenantId, rideId, driver }) {
  const updated = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      tenantId,
      status: 'requested',
      offers: { $elemMatch: { driverId: driver._id, status: 'pending' } },
    },
    { $set: { 'offers.$[offer].status': 'declined' } },
    { returnDocument: 'after', arrayFilters: [{ 'offer.driverId': driver._id, 'offer.status': 'pending' }] },
  );
  if (!updated) throw conflict('OFFER_EXPIRED', 'Esta oferta não está mais disponível.');
  dispatchNext(rideId).catch((error) => console.error('Falha no despacho:', error));
  return updated;
}

// -------------------------------------------------------------- avaliação

function averageUpdate(stars) {
  return [
    {
      $set: {
        ratingAvg: {
          $round: [
            { $divide: [{ $add: [{ $multiply: [{ $ifNull: ['$ratingAvg', 0] }, { $ifNull: ['$ratingCount', 0] }] }, stars] }, { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] }] },
            2,
          ],
        },
        ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] },
      },
    },
  ];
}

export async function rateRide({ tenantId, rideId, actor, userId, stars, comment }) {
  const ride = await findRideFor({ tenantId, rideId, role: actor, userId });
  if (!canRate(ride.status)) throw conflict('RIDE_NOT_COMPLETED', 'Só é possível avaliar depois que a corrida termina.');

  const field = actor === 'passenger' ? 'passengerRating' : 'driverRating';
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, [field]: { $exists: false } },
    { $set: { [field]: { stars, comment, at: new Date() } } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('ALREADY_RATED', 'Você já avaliou esta corrida.');

  // Atualiza a média de quem foi avaliado (cálculo feito no banco, sem corrida de leitura/escrita).
  if (actor === 'passenger') await Driver.updateOne({ _id: ride.driverId, tenantId }, averageUpdate(stars), { updatePipeline: true });
  else await Passenger.updateOne({ _id: ride.passengerId, tenantId }, averageUpdate(stars), { updatePipeline: true });
  return updated;
}

export { forbidden };
