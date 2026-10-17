import { emit, rooms } from '../realtime/emitter.js';
import { serializeRide } from './serialize.js';

/** Painel da operadora (mapa ao vivo, lista de corridas): recebe toda mudança de corrida. */
export function emitAdminRide(ride) {
  emit(rooms.admin(String(ride.tenantId)), 'live:ride', serializeRide(ride, 'admin'));
}
