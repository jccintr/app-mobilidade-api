import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { avatarUpload } from '../middlewares/upload.js';
import {
  codeOnlySchema,
  emailCodeSchema,
  emailOnlySchema,
  loginSchema,
  pushTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateMeSchema,
} from '../modules/accounts/schemas.js';

/**
 * Rotas iguais para passageiro e motorista.
 * Públicas: cadastro, login, recuperação de senha. O resto exige token.
 */
export function buildAccountRouter({ controller, role }) {
  const router = Router();

  // ---- públicas ----
  router.post('/register', authLimiter, validate(registerSchema), asyncHandler(controller.register));
  router.post('/login', authLimiter, validate(loginSchema), asyncHandler(controller.login));
  router.post('/password/request', authLimiter, validate(emailOnlySchema), asyncHandler(controller.passwordRequest));
  router.post('/password/verify-code', authLimiter, validate(emailCodeSchema), asyncHandler(controller.passwordVerifyCode));
  router.post('/password/reset', authLimiter, validate(resetPasswordSchema), asyncHandler(controller.passwordReset));

  // ---- exigem login ----
  router.use(authenticate(role));
  router.get('/me', controller.me);
  router.patch('/me', validate(updateMeSchema), asyncHandler(controller.updateMe));
  router.patch('/me/avatar', avatarUpload, asyncHandler(controller.uploadAvatar));
  router.patch('/me/push-token', validate(pushTokenSchema), asyncHandler(controller.updatePushToken));
  router.post('/verify-account', authLimiter, validate(codeOnlySchema), asyncHandler(controller.verifyAccount));
  router.post('/verify-account/resend', authLimiter, asyncHandler(controller.resendVerification));

  return router;
}
