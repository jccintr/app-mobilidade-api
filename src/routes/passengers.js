import { Passenger } from '../models/Passenger.js';
import { buildAccountController } from '../modules/accounts/accountController.js';
import { requireVerified } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { passengerRideController as rides } from '../modules/rides/passengerRideController.js';
import {
  cancelSchema,
  directionsQuery,
  estimateSchema,
  listRidesQuery,
  placeDetailsQuery,
  placesQuery,
  messageSchema,
  messagesQuery,
  rateSchema,
  requestRideSchema,
  rideIdParam,
} from '../modules/rides/schemas.js';
import { buildAccountRouter } from './accountRouter.js';
import { directionsLimiter, placesLimiter } from '../middlewares/rateLimit.js';
import { rideDirections } from '../modules/rides/directionsController.js';
import { autocomplete, details } from '../services/places.js';

export const passengersRouter = buildAccountRouter({
  controller: buildAccountController({ Model: Passenger, role: 'passenger' }),
  role: 'passenger',
});

// ---- corridas (já autenticado como passageiro) ----
const byId = validate(rideIdParam, 'params');
passengersRouter.post('/rides/estimate', validate(estimateSchema), asyncHandler(rides.estimate));
passengersRouter.post('/rides', requireVerified, validate(requestRideSchema), asyncHandler(rides.create));
passengersRouter.get('/rides/active', asyncHandler(rides.active));
passengersRouter.get('/rides', validate(listRidesQuery, 'query'), asyncHandler(rides.list));
passengersRouter.get('/rides/:id', byId, asyncHandler(rides.get));
passengersRouter.get('/rides/:id/directions', directionsLimiter, byId, validate(directionsQuery, 'query'), asyncHandler(rideDirections('passenger')));
passengersRouter.post('/rides/:id/cancel', byId, validate(cancelSchema), asyncHandler(rides.cancel));
passengersRouter.post('/rides/:id/rate', byId, validate(rateSchema), asyncHandler(rides.rate));
passengersRouter.get('/rides/:id/messages', byId, validate(messagesQuery, 'query'), asyncHandler(rides.messages));
passengersRouter.post('/rides/:id/messages', byId, validate(messageSchema), asyncHandler(rides.sendMessage));

// ---- busca de endereços (proxy do Google Places; a chave fica no servidor) ----
passengersRouter.get(
  '/places/autocomplete',
  placesLimiter,
  validate(placesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, lat, lng, session } = req.valid;
    res.json({ results: await autocomplete({ input: q, lat, lng, session }) });
  }),
);
passengersRouter.get(
  '/places/details',
  placesLimiter,
  validate(placeDetailsQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ place: await details({ placeId: req.valid.placeId, session: req.valid.session }) });
  }),
);
