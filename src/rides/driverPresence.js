import { Driver } from '../models/Driver.js';
import { Ride } from '../models/Ride.js';
import { emit, rooms } from '../realtime/emitter.js';
import { conflict, forbidden } from '../utils/errors.js';
import { toPoint } from '../utils/geo.js';
import { ASSIGNED_STATUSES } from './stateMachine.js';

const PERSIST_EVERY_MS = 10_000;
const lastPersist = new Map(); // driverId -> timestamp
const watchers = new Map(); // driverId -> { passengerId, rideId, checkedAt } | { none: true, checkedAt }
const RECHECK_MS = 30_000;

async function activeRideOf(tenantId, driverId) {
  const key = String(driverId);
  const cached = watchers.get(key);
  if (cached && Date.now() - cached.checkedAt < RECHECK_MS) return cached.none ? null : cached;
  const ride = await Ride.findOne({ tenantId, driverId, status: { $in: ASSIGNED_STATUSES } }).select('passengerId').lean();
  const entry = ride ? { passengerId: ride.passengerId, rideId: ride._id, checkedAt: Date.now() } : { none: true, checkedAt: Date.now() };
  watchers.set(key, entry);
  return ride ? entry : null;
}

/** Chamado quando a corrida do motorista começa ou termina, para o cache não ficar velho. */
export function forgetDriverRide(driverId) {
  watchers.delete(String(driverId));
}

/**
 * Posição ao vivo: vai direto para o passageiro da corrida (sem tocar no banco a cada ponto).
 * No banco gravamos no máximo a cada 10 s, o suficiente para o despacho achar o motorista mais próximo.
 */
export async function updateDriverLocation({ tenantId, driverId, lat, lng, heading }) {
  const now = Date.now();
  const key = String(driverId);

  if (now - (lastPersist.get(key) ?? 0) >= PERSIST_EVERY_MS) {
    lastPersist.set(key, now);
    const result = await Driver.updateOne(
      { _id: driverId, tenantId, status: 'approved' },
      { $set: { location: toPoint({ lat, lng }), locationUpdatedAt: new Date(now) } },
    );
    if (!result.matchedCount) {
      lastPersist.delete(key);
      throw forbidden('DRIVER_NOT_APPROVED', 'Seu cadastro não está aprovado.');
    }
  }

  emit(rooms.admin(String(tenantId)), 'live:driver-location', {
    driverId: key,
    lat,
    lng,
    heading,
    at: new Date(now).toISOString(),
  });

  const active = await activeRideOf(tenantId, driverId);
  if (active) {
    emit(rooms.passenger(tenantId, active.passengerId), 'ride:driver-location', {
      rideId: String(active.rideId),
      lat,
      lng,
      heading,
      at: new Date(now).toISOString(),
    });
  }
}

export async function setDriverOnline({ driver, online, lat, lng }) {
  if (driver.status !== 'approved') {
    throw forbidden('DRIVER_NOT_APPROVED', 'Seu cadastro ainda não foi aprovado pela operadora.');
  }
  if (online) {
    if (lat === undefined || lng === undefined) {
      throw conflict('LOCATION_REQUIRED', 'Envie sua localização para ficar online.');
    }
    driver.location = toPoint({ lat, lng });
    driver.locationUpdatedAt = new Date();
    driver.online = true;
    lastPersist.set(String(driver._id), Date.now());
  } else {
    const busy = await Ride.exists({ tenantId: driver.tenantId, activeDriverId: driver._id });
    if (busy) throw conflict('RIDE_IN_PROGRESS', 'Termine ou cancele a corrida atual antes de ficar offline.');
    driver.online = false;
  }
  await driver.save();
  emit(rooms.admin(String(driver.tenantId)), 'live:driver-status', { driverId: String(driver._id), online: driver.online });
  return driver;
}
