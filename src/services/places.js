import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/**
 * Busca de endereços (Google Places) feita PELO SERVIDOR: a chave nunca vai dentro do app
 * e o passageiro não precisa de chave própria. Tenta a API nova e, se ela não estiver
 * habilitada no projeto Google, cai para a API clássica.
 */
const NEW = 'https://places.googleapis.com/v1';
const LEGACY = 'https://maps.googleapis.com/maps/api/place';
const TIMEOUT_MS = 6000;

const unavailable = (detail) => new AppError(502, 'PLACES_UNAVAILABLE', 'A busca de endereços está indisponível no momento.', detail ? { detail } : undefined);

function requireKey() {
  if (!env.rides.googleMapsApiKey) {
    throw new AppError(503, 'PLACES_NOT_CONFIGURED', 'A busca de endereços não está configurada (GOOGLE_MAPS_API_KEY).');
  }
  return env.rides.googleMapsApiKey;
}

async function call(url, init, fetchImpl) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function autocomplete({ input, lat, lng, session }, fetchImpl = fetch) {
  const key = requireKey();
  const hasBias = lat !== undefined && lng !== undefined;

  try {
    const body = {
      input,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      ...(session ? { sessionToken: session } : {}),
      ...(hasBias ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } } } : {}),
    };
    const r = await call(`${NEW}/places:autocomplete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key }, body: JSON.stringify(body) }, fetchImpl);
    if (r.ok) {
      return (r.data.suggestions ?? [])
        .filter((s) => s.placePrediction)
        .map(({ placePrediction: p }) => ({
          placeId: p.placeId,
          title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
          subtitle: p.structuredFormat?.secondaryText?.text ?? '',
        }));
    }
  } catch {
    /* tenta a API clássica */
  }

  try {
    const q = new URLSearchParams({ input, key, language: 'pt-BR', components: 'country:br', ...(session ? { sessiontoken: session } : {}), ...(hasBias ? { location: `${lat},${lng}`, radius: '50000' } : {}) });
    const r = await call(`${LEGACY}/autocomplete/json?${q}`, {}, fetchImpl);
    const status = r.data.status;
    if (status === 'OK' || status === 'ZERO_RESULTS') {
      return (r.data.predictions ?? []).map((p) => ({
        placeId: p.place_id,
        title: p.structured_formatting?.main_text ?? p.description,
        subtitle: p.structured_formatting?.secondary_text ?? '',
      }));
    }
    throw unavailable(r.data.error_message ?? status);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(error.message);
  }
}

export async function details({ placeId, session }, fetchImpl = fetch) {
  const key = requireKey();

  try {
    const q = session ? `?sessionToken=${encodeURIComponent(session)}` : '';
    const r = await call(`${NEW}/places/${encodeURIComponent(placeId)}${q}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location,formattedAddress,displayName' } }, fetchImpl);
    if (r.ok && r.data.location) {
      const name = r.data.displayName?.text;
      const address = r.data.formattedAddress ?? name ?? '';
      return { lat: r.data.location.latitude, lng: r.data.location.longitude, address: name && !address.startsWith(name) ? `${name} - ${address}` : address };
    }
  } catch {
    /* tenta a API clássica */
  }

  try {
    const q = new URLSearchParams({ place_id: placeId, key, language: 'pt-BR', fields: 'geometry,formatted_address,name', ...(session ? { sessiontoken: session } : {}) });
    const r = await call(`${LEGACY}/details/json?${q}`, {}, fetchImpl);
    const result = r.data.result;
    if (r.data.status === 'OK' && result?.geometry?.location) {
      const address = result.formatted_address ?? result.name ?? '';
      return { lat: result.geometry.location.lat, lng: result.geometry.location.lng, address: result.name && !address.startsWith(result.name) ? `${result.name} - ${address}` : address };
    }
    throw unavailable(r.data.error_message ?? r.data.status);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(error.message);
  }
}
