import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AdminUser } from '../models/AdminUser.js';
import { Driver } from '../models/Driver.js';
import { Passenger } from '../models/Passenger.js';
import { Tenant } from '../models/Tenant.js';
import { sendMessage } from '../rides/chat.js';
import { updateDriverLocation } from '../rides/driverPresence.js';
import { verifyToken } from '../utils/tokens.js';
import { setIo, rooms } from './emitter.js';

const MODELS = { passenger: Passenger, driver: Driver, operator_admin: AdminUser };

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
});
const chatSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  text: z.string().trim().min(1).max(500),
});

/** Autentica a conexão: mesmas regras da API REST (token válido, mesma operadora, conta ativa). */
async function authenticateSocket(socket) {
  const { token, tenant: slug } = socket.handshake.auth ?? {};
  if (!token || !slug) throw new Error('UNAUTHORIZED');

  const tenant = await Tenant.findOne({ slug: String(slug).trim().toLowerCase(), active: true }).lean();
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new Error('INVALID_TOKEN');
  }
  const Model = MODELS[payload.role];
  if (!Model) throw new Error('FORBIDDEN');

  const user = await Model.findById(payload.sub);
  if (!user || (user.tokenVersion ?? 0) !== payload.tv) throw new Error('SESSION_REVOKED');
  if (String(user.tenantId) !== String(tenant._id)) throw new Error('TENANT_MISMATCH');
  if (user.status === 'blocked') throw new Error('ACCOUNT_BLOCKED');
  if (payload.role === 'operator_admin' && (user.role !== 'operator_admin' || !user.active)) throw new Error('FORBIDDEN');

  socket.data = { role: payload.role, userId: String(user._id), tenantId: String(tenant._id) };
}

/** Limite simples por conexão: 40 eventos a cada 10 s. */
function createLimiter() {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > 10_000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= 40;
  };
}

const reply = (ack, payload) => typeof ack === 'function' && ack(payload);
const failure = (error) => ({ ok: false, error: { code: error.code ?? 'ERROR', message: error.message } });

export function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins.length ? env.corsOrigins : true },
    maxHttpBufferSize: 1e5,
  });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      await authenticateSocket(socket);
      next();
    } catch (error) {
      next(new Error(error.message));
    }
  });

  io.on('connection', (socket) => {
    const { role, userId, tenantId } = socket.data;
    if (role === 'operator_admin') {
      // Painel da operadora: só escuta (mapa ao vivo e corridas), não envia eventos.
      socket.join(rooms.admin(tenantId));
      return;
    }
    socket.join(role === 'driver' ? rooms.driver(tenantId, userId) : rooms.passenger(tenantId, userId));
    const allowed = createLimiter();

    if (role === 'driver') {
      socket.on('driver:location', async (payload, ack) => {
        if (!allowed()) return reply(ack, { ok: false, error: { code: 'RATE_LIMITED', message: 'Muitos eventos.' } });
        const parsed = locationSchema.safeParse(payload);
        if (!parsed.success) return reply(ack, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Localização inválida.' } });
        try {
          await updateDriverLocation({ tenantId, driverId: userId, ...parsed.data });
          reply(ack, { ok: true });
        } catch (error) {
          reply(ack, failure(error));
        }
      });
    }

    socket.on('chat:send', async (payload, ack) => {
      if (!allowed()) return reply(ack, { ok: false, error: { code: 'RATE_LIMITED', message: 'Muitos eventos.' } });
      const parsed = chatSchema.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Mensagem inválida.' } });
      try {
        const message = await sendMessage({ tenantId, rideId: parsed.data.rideId, role, userId, text: parsed.data.text });
        reply(ack, { ok: true, message });
      } catch (error) {
        reply(ack, failure(error));
      }
    });
  });

  return io;
}
