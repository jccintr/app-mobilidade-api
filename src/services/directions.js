import { env } from '../config/env.js';
import { haversineKm } from '../utils/geo.js';

/**
 * Rota para NAVEGAR (desenho no mapa + instruções de manobra). Diferente de routing/, que só calcula
 * distância e tempo para o preço. Nunca falha: sem chave ou com o Google fora do ar, devolve uma linha reta
 * marcada como `approximate`, e os apps seguem funcionando.
 *
 * Resultado: { points: [[lat,lng]...], steps: [{ instruction, maneuver, distanceMeters, end }], distanceMeters, durationSeconds, approximate }
 */

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const LEGACY_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const MAX_POINTS = 400;
const CACHE_MS = 15_000;
const cache = new Map();

/** Decodifica o formato "encoded polyline" do Google (precisão 1e5). */
export function decodePolyline(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i <= str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

function thin(points) {
  if (points.length <= MAX_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_POINTS);
  const out = points.filter((_, idx) => idx % stride === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

const stripHtml = (s = '') =>
  s
    .replace(/<div[^>]*>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function viaRoutesApi(from, to, key, fetchImpl) {
  const response = await fetchImpl(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.endLocation',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'pt-BR',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const found = data.routes?.[0];
  if (!found?.polyline?.encodedPolyline) return null;
  const steps = (found.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .filter((s) => s.endLocation?.latLng)
    .map((s) => ({
      instruction: s.navigationInstruction?.instructions ?? 'Siga em frente',
      maneuver: s.navigationInstruction?.maneuver ?? null,
      distanceMeters: s.distanceMeters ?? 0,
      end: { lat: s.endLocation.latLng.latitude, lng: s.endLocation.latLng.longitude },
    }));
  return {
    points: decodePolyline(found.polyline.encodedPolyline),
    steps,
    distanceMeters: found.distanceMeters ?? 0,
    durationSeconds: Number.parseInt(String(found.duration ?? '0').replace('s', ''), 10) || 0,
  };
}

async function viaLegacyApi(from, to, key, fetchImpl) {
  const q = new URLSearchParams({ origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, mode: 'driving', language: 'pt-BR', key });
  const response = await fetchImpl(`${LEGACY_URL}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json();
  const found = data.status === 'OK' ? data.routes?.[0] : null;
  if (!found?.overview_polyline?.points) return null;
  const leg = found.legs?.[0];
  return {
    points: decodePolyline(found.overview_polyline.points),
    steps: (leg?.steps ?? []).map((s) => ({
      instruction: stripHtml(s.html_instructions),
      maneuver: s.maneuver ? s.maneuver.toUpperCase().replace(/-/g, '_') : null,
      distanceMeters: s.distance?.value ?? 0,
      end: { lat: s.end_location.lat, lng: s.end_location.lng },
    })),
    distanceMeters: leg?.distance?.value ?? 0,
    durationSeconds: leg?.duration?.value ?? 0,
  };
}

function straightLine(from, to) {
  const meters = Math.round(haversineKm(from, to) * 1.3 * 1000);
  return {
    points: [[from.lat, from.lng], [to.lat, to.lng]],
    steps: [{ instruction: 'Siga em direção ao destino', maneuver: null, distanceMeters: meters, end: { lat: to.lat, lng: to.lng } }],
    distanceMeters: meters,
    durationSeconds: Math.round((meters / 1000 / 25) * 3600),
    approximate: true,
  };
}

export async function directions(from, to, fetchImpl = fetch) {
  const key = env.rides.googleMapsApiKey;
  if (!key) return straightLine(from, to);

  const id = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(',');
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let result = null;
  for (const provider of [viaRoutesApi, viaLegacyApi]) {
    try {
      result = await provider(from, to, key, fetchImpl);
    } catch {
      result = null;
    }
    if (result) break;
  }
  const value = result ? { ...result, points: thin(result.points), approximate: false } : straightLine(from, to);
  if (result) {
    if (cache.size > 500) cache.clear();
    cache.set(id, { at: Date.now(), value });
  }
  return value;
}
