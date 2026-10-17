import { haversineKm } from '../../utils/geo.js';

/**
 * Provedor de desenvolvimento: linha reta x 1,3 (fator de curva urbana) e 25 km/h.
 * NÃO use em produção: não conhece ruas.
 */
export async function route(origin, destination) {
  const km = haversineKm(origin, destination) * 1.3;
  return {
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.max(1, Math.round((km / 25) * 60)),
  };
}
