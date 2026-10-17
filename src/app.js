import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './config/env.js';
import { resolveTenant } from './middlewares/tenant.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { uploadRoot } from './services/storage/local.js';
import { passengersRouter } from './routes/passengers.js';
import { driversRouter } from './routes/drivers.js';
import { adminRouter } from './routes/admin.js';
import { superRouter } from './routes/super.js';
import { publicTenantRouter } from './routes/publicTenant.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // atrás do proxy (Render/Railway): IP real para o limitador
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // avatares abrem em outros domínios
  app.use(
    cors({
      // Sem cookies (usamos token Bearer), então liberar tudo é aceitável quando CORS_ORIGINS não está definido.
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // Só a pasta "public" é servida (avatares). Documentos ficam em "private" e passam pelo painel.
  app.use('/uploads/public', express.static(path.join(uploadRoot(), 'public'), { index: false, maxAge: '7d' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: env.platformName, time: new Date().toISOString() });
  });

  app.use('/super', superRouter);
  app.use('/tenant/public', resolveTenant, publicTenantRouter);
  app.use('/passengers', resolveTenant, passengersRouter);
  app.use('/drivers', resolveTenant, driversRouter);
  app.use('/admin', resolveTenant, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
