import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { documentUpload, receiptUpload } from '../middlewares/upload.js';
import { requireVerified } from '../middlewares/auth.js';
import { driverCreditsController as credits } from '../modules/credits/driverCreditsController.js';
import { createPurchaseSchema, idParam, informSchema, pageQuery } from '../modules/credits/schemas.js';
import { driverController } from '../modules/accounts/driverController.js';
import { documentParamSchema, vehicleSchema } from '../modules/accounts/schemas.js';
import { driverRideController as rides, requireApprovedDriver } from '../modules/rides/driverRideController.js';
import {
  cancelSchema,
  directionsQuery,
  finishSchema,
  listRidesQuery,
  locationSchema,
  messageSchema,
  messagesQuery,
  onlineSchema,
  rateSchema,
  rideIdParam,
} from '../modules/rides/schemas.js';
import { rideDirections } from '../modules/rides/directionsController.js';
import { directionsLimiter } from '../middlewares/rateLimit.js';
import { buildAccountRouter } from './accountRouter.js';

export const driversRouter = buildAccountRouter({ controller: driverController, role: 'driver' });

// (já autenticadas: buildAccountRouter aplica o login antes de devolver o router)
driversRouter.patch('/me/vehicle', validate(vehicleSchema), asyncHandler(driverController.updateVehicle));
driversRouter.put(
  '/me/documents/:type',
  validate(documentParamSchema, 'params'),
  documentUpload,
  asyncHandler(driverController.uploadDocument),
);

// ---- disponibilidade e posição ----
driversRouter.patch('/me/online', requireApprovedDriver, validate(onlineSchema), asyncHandler(rides.setOnline));
driversRouter.post('/me/location', requireApprovedDriver, validate(locationSchema), asyncHandler(rides.location));

// ---- corridas ----
const byId = validate(rideIdParam, 'params');
driversRouter.get('/rides/active', asyncHandler(rides.active));
driversRouter.get('/rides', validate(listRidesQuery, 'query'), asyncHandler(rides.list));
driversRouter.get('/rides/:id', byId, asyncHandler(rides.get));
driversRouter.get('/rides/:id/directions', directionsLimiter, byId, validate(directionsQuery, 'query'), asyncHandler(rideDirections('driver')));
driversRouter.post('/rides/:id/accept', requireApprovedDriver, byId, asyncHandler(rides.accept));
driversRouter.post('/rides/:id/decline', requireApprovedDriver, byId, asyncHandler(rides.decline));
driversRouter.post('/rides/:id/arrive', byId, asyncHandler(rides.arrive));
driversRouter.post('/rides/:id/start', byId, asyncHandler(rides.start));
driversRouter.post('/rides/:id/finish', byId, validate(finishSchema), asyncHandler(rides.finish));
driversRouter.post('/rides/:id/cancel', byId, validate(cancelSchema), asyncHandler(rides.cancel));
driversRouter.post('/rides/:id/rate', byId, validate(rateSchema), asyncHandler(rides.rate));
driversRouter.get('/rides/:id/messages', byId, validate(messagesQuery, 'query'), asyncHandler(rides.messages));
driversRouter.post('/rides/:id/messages', byId, validate(messageSchema), asyncHandler(rides.sendMessage));

// ---- créditos (saldo pré-pago que paga a taxa da operadora; compra via Pix na página web do motorista) ----
// Qualquer motorista com e-mail confirmado pode comprar (inclusive antes da aprovação); corridas exigem aprovação.
const purchaseId = validate(idParam, 'params');
driversRouter.get('/me/wallet', asyncHandler(credits.wallet));
driversRouter.get('/me/wallet/entries', validate(pageQuery, 'query'), asyncHandler(credits.entries));
driversRouter.get('/credits/packages', asyncHandler(credits.packages));
driversRouter.get('/credits/purchases', validate(pageQuery, 'query'), asyncHandler(credits.listPurchases));
driversRouter.post('/credits/purchases', requireVerified, validate(createPurchaseSchema), asyncHandler(credits.createPurchase));
driversRouter.get('/credits/purchases/:id', purchaseId, asyncHandler(credits.getPurchase));
driversRouter.post('/credits/purchases/:id/inform', purchaseId, receiptUpload, validate(informSchema), asyncHandler(credits.inform));
driversRouter.post('/credits/purchases/:id/cancel', purchaseId, asyncHandler(credits.cancelPurchase));
