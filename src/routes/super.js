import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { superController as c } from '../modules/admin/superController.js';
import {
  adminLoginSchema,
  createOperatorAdminSchema,
  createTenantSchema,
  idParamSchema,
  updateTenantSchema,
} from '../modules/admin/schemas.js';

/** Painel do dono da plataforma. Não usa X-Tenant. */
export const superRouter = Router();

superRouter.post('/login', authLimiter, validate(adminLoginSchema), asyncHandler(c.login));

superRouter.use(authenticate('super_admin'));
superRouter.get('/tenants', asyncHandler(c.listTenants));
superRouter.post('/tenants', validate(createTenantSchema), asyncHandler(c.createTenant));
superRouter.patch('/tenants/:id', validate(idParamSchema, 'params'), validate(updateTenantSchema), asyncHandler(c.updateTenant));
superRouter.post(
  '/tenants/:id/admins',
  validate(idParamSchema, 'params'),
  validate(createOperatorAdminSchema),
  asyncHandler(c.createOperatorAdmin),
);
