import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

const URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Google Routes API (computeRoutes), com trânsito em tempo real.
 * ATENÇÃO: não foi testado com uma chave real. Cobrança por requisição.
 */
export async function route(origin, destination) {
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.rides.googleMapsApiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'pt-BR',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!response?.ok) {
    throw new AppError(502, 'ROUTING_UNAVAILABLE', 'Não foi possível calcular a rota agora. Tente novamente.');
  }
  const data = await response.json();
  const found = data.routes?.[0];
  if (!found?.distanceMeters) {
    throw new AppError(422, 'ROUTE_NOT_FOUND', 'Não há rota entre os pontos informados.');
  }
  const seconds = Number.parseInt(String(found.duration ?? '0').replace('s', ''), 10) || 0;
  return {
    distanceKm: Math.round(found.distanceMeters / 100) / 10,
    durationMin: Math.max(1, Math.round(seconds / 60)),
  };
}
