import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { adminController as c } from '../modules/admin/adminController.js';
import { pricingController as p } from '../modules/admin/pricingController.js';
import { settingsController as st } from '../modules/admin/settingsController.js';
import { logoUpload } from '../middlewares/upload.js';
import { ridesAdminController as rd } from '../modules/admin/ridesController.js';
import { conditionsSchema, listRidesQuery, rideIdParam } from '../modules/rides/schemas.js';
import {
  adminLoginSchema,
  createPricingRuleSchema,
  driverDocumentParamSchema,
  idParamSchema,
  listDriversQuery,
  listPassengersQuery,
  rejectSchema,
  simulateSchema,
  updateSettingsSchema,
} from '../modules/admin/schemas.js';
import { emailOnlySchema, resetPasswordSchema } from '../modules/accounts/schemas.js';

/** Painel da operadora (tudo filtrado pela operadora do X-Tenant). */
export const adminRouter = Router();

adminRouter.post('/login', authLimiter, validate(adminLoginSchema), asyncHandler(c.login));
adminRouter.post('/password/request', authLimiter, validate(emailOnlySchema), asyncHandler(c.passwordRequest));
adminRouter.post('/password/reset', authLimiter, validate(resetPasswordSchema), asyncHandler(c.passwordReset));

adminRouter.use(authenticate('operator_admin'));
adminRouter.get('/me', c.me);

// Motoristas
const byId = validate(idParamSchema, 'params');
adminRouter.get('/drivers', validate(listDriversQuery, 'query'), asyncHandler(c.listDrivers));
adminRouter.get('/drivers/:id', byId, asyncHandler(c.getDriver));
adminRouter.get('/drivers/:id/documents/:type', validate(driverDocumentParamSchema, 'params'), asyncHandler(c.driverDocument));
adminRouter.post('/drivers/:id/approve', byId, asyncHandler(c.approveDriver));
adminRouter.post('/drivers/:id/reject', byId, validate(rejectSchema), asyncHandler(c.rejectDriver));
adminRouter.post('/drivers/:id/block', byId, asyncHandler(c.blockDriver));
adminRouter.post('/drivers/:id/unblock', byId, asyncHandler(c.unblockDriver));

// Passageiros
adminRouter.get('/passengers', validate(listPassengersQuery, 'query'), asyncHandler(c.listPassengers));
adminRouter.post('/passengers/:id/block', byId, asyncHandler(c.blockPassenger));
adminRouter.post('/passengers/:id/unblock', byId, asyncHandler(c.unblockPassenger));

// Regras de tarifa
adminRouter.get('/pricing-rules', asyncHandler(p.list));
adminRouter.get('/pricing-rules/active', asyncHandler(p.active));
adminRouter.post('/pricing-rules', validate(createPricingRuleSchema), asyncHandler(p.create));
adminRouter.post('/pricing-rules/:id/activate', byId, asyncHandler(p.activateRule));
adminRouter.post('/pricing-rules/:id/deactivate', byId, asyncHandler(p.deactivateRule));
adminRouter.post('/pricing/simulate', validate(simulateSchema), asyncHandler(p.simulate));

// Corridas e condições
adminRouter.get('/rides', validate(listRidesQuery, 'query'), asyncHandler(rd.list));
adminRouter.get('/rides/:id', validate(rideIdParam, 'params'), asyncHandler(rd.get));
adminRouter.get('/dashboard', asyncHandler(rd.dashboard));
adminRouter.get('/live', asyncHandler(rd.live));
adminRouter.get('/conditions', asyncHandler(rd.getConditions));
adminRouter.put('/conditions', validate(conditionsSchema), asyncHandler(rd.setConditions));

// Configurações da operadora (marca, cidades, onde o mapa abre)
adminRouter.get('/settings', asyncHandler(st.get));
adminRouter.patch('/settings', validate(updateSettingsSchema), asyncHandler(st.update));
adminRouter.put('/settings/logo', logoUpload, asyncHandler(st.uploadLogo));
adminRouter.delete('/settings/logo', asyncHandler(st.removeLogo));
