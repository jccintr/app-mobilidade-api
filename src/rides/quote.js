import { env } from '../config/env.js';
import { PricingRule } from '../models/PricingRule.js';
import { calculateFare } from '../pricing/engine.js';
import { VEHICLE_TYPES } from '../pricing/schema.js';
import { getRoute } from '../services/routing/index.js';
import { badRequest, conflict } from '../utils/errors.js';
import { haversineKm } from '../utils/geo.js';

/**
 * Calcula rota e preço(s) de uma corrida usando a regra ATIVA da operadora.
 * O servidor sempre recalcula: o app nunca informa o valor.
 */
export async function buildQuotes({ tenant, pickup, dropoff, vehicleTypes }) {
  const straight = haversineKm(pickup, dropoff);
  if (straight < 0.05) throw badRequest('SAME_LOCATION', 'Origem e destino estão no mesmo lugar.');
  if (straight > env.rides.maxRideKm) {
    throw badRequest('RIDE_TOO_LONG', `Distância máxima por corrida: ${env.rides.maxRideKm} km.`);
  }

  const rule = await PricingRule.findOne({ tenantId: tenant._id, active: true });
  if (!rule) throw conflict('PRICING_NOT_CONFIGURED', 'A operadora ainda não configurou a tarifa.');

  const route = await getRoute(pickup, dropoff);
  if (route.distanceKm > env.rides.maxRideKm) {
    throw badRequest('RIDE_TOO_LONG', `Distância máxima por corrida: ${env.rides.maxRideKm} km.`);
  }

  const requestedAt = new Date();
  const rain = Boolean(tenant.conditions?.rain);
  const available = Object.keys(rule.config.vehicleTariffs ?? {}).filter((type) => VEHICLE_TYPES.includes(type));
  const types = (vehicleTypes ?? available).filter((type) => available.includes(type));
  if (!types.length) throw badRequest('VEHICLE_NOT_SUPPORTED', 'Esta operadora não atende esse tipo de veículo.');

  const fares = {};
  const inputs = {};
  for (const vehicleType of types) {
    const input = { vehicleType, distanceKm: route.distanceKm, durationMin: route.durationMin, requestedAt, rain, zones: [] };
    inputs[vehicleType] = input;
    fares[vehicleType] = calculateFare(rule.config, input);
  }
  return { rule, route, fares, inputs };
}
