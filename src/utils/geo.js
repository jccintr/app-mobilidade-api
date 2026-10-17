const EARTH_RADIUS_KM = 6371.0088;

/** Distância em linha reta entre dois pontos {lat, lng}, em km. */
export function haversineKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GeoJSON usa [longitude, latitude]. */
export const toPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
export const fromPoint = (point) => ({ lat: point.coordinates[1], lng: point.coordinates[0] });
