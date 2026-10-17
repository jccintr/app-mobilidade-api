import { findRideFor } from '../../rides/rideService.js';
import { directions } from '../../services/directions.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { fromPoint } from '../../utils/geo.js';

/**
 * Rota para navegar na corrida atual (motorista e passageiro usam o mesmo cálculo):
 *  - a caminho do embarque: da posição informada até o embarque;
 *  - no local: do embarque até o destino (prévia);
 *  - em viagem: da posição informada até o destino.
 */
export const rideDirections = (role) => async (req, res) => {
  const { id, lat, lng } = req.valid;
  const ride = await findRideFor({ tenantId: req.tenant._id, rideId: id, role, userId: req.user._id });
  const pickup = fromPoint(ride.pickup.location);
  const dropoff = fromPoint(ride.dropoff.location);
  const pos = lat !== undefined && lng !== undefined ? { lat, lng } : null;

  let from;
  let to;
  let leg;
  if (ride.status === 'accepted') [from, to, leg] = [pos, pickup, 'to_pickup'];
  else if (ride.status === 'arrived') [from, to, leg] = [pickup, dropoff, 'to_dropoff'];
  else if (ride.status === 'in_progress') [from, to, leg] = [pos, dropoff, 'to_dropoff'];
  else throw conflict('RIDE_NOT_NAVIGABLE', 'Esta corrida não está em andamento.');

  if (!from) throw badRequest('POSITION_REQUIRED', 'Informe lat e lng da posição atual.');
  res.json({ leg, ...(await directions(from, to)) });
};
