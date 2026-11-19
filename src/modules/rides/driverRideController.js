import { Ride } from '../../models/Ride.js';
import { listMessages, sendMessage } from '../../rides/chat.js';
import { setDriverOnline, updateDriverLocation } from '../../rides/driverPresence.js';
import { acceptRide, declineRide, findRideFor, rateRide, transition } from '../../rides/rideService.js';
import { serializeRide } from '../../rides/serialize.js';
import { ASSIGNED_STATUSES } from '../../rides/stateMachine.js';
import { forbidden } from '../../utils/errors.js';

const view = (ride) => ({ ride: serializeRide(ride, 'driver') });
const ids = (req) => ({ tenantId: req.tenant._id, userId: req.user._id });

/** Só motorista aprovado conduz corridas. */
export function requireApprovedDriver(req, _res, next) {
  if (req.user.status !== 'approved') {
    return next(forbidden('DRIVER_NOT_APPROVED', 'Seu cadastro ainda não foi aprovado pela operadora.'));
  }
  next();
}

export const driverRideController = {
  async setOnline(req, res) {
    const { online, lat, lng } = req.valid;
    const driver = await setDriverOnline({ driver: req.user, online, lat, lng });
    res.json({ user: driver });
  },

  async location(req, res) {
    const { tenantId, userId } = ids(req);
    await updateDriverLocation({ tenantId, driverId: userId, ...req.valid });
    res.json({ ok: true });
  },

  /** Para o app recuperar o estado ao abrir: corrida em curso e/ou oferta pendente. */
  async active(req, res) {
    const { tenantId, userId } = ids(req);
    const now = new Date();
    const [active, offer] = await Promise.all([
      Ride.findOne({ tenantId, driverId: userId, status: { $in: ASSIGNED_STATUSES } }),
      Ride.findOne({
        tenantId,
        status: 'requested',
        offers: { $elemMatch: { driverId: userId, status: 'pending', expiresAt: { $gt: now } } },
      }),
    ]);
    const pending = offer?.offers.find((item) => String(item.driverId) === String(userId) && item.status === 'pending');
    res.json({
      ride: active ? serializeRide(active, 'driver') : null,
      offer: offer ? { ride: serializeRide(offer, 'driver'), expiresAt: pending.expiresAt } : null,
    });
  },

  async list(req, res) {
    const { tenantId, userId } = ids(req);
    const { page, limit, status } = req.valid;
    const filter = { tenantId, driverId: userId, ...(status ? { status } : {}) };
    const [rides, total] = await Promise.all([
      Ride.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Ride.countDocuments(filter),
    ]);
    res.json({ data: rides.map((ride) => serializeRide(ride, 'driver')), page, limit, total, totalPages: Math.ceil(total / limit) });
  },

  async get(req, res) {
    const { tenantId, userId } = ids(req);
    res.json(view(await findRideFor({ tenantId, rideId: req.valid.id, role: 'driver', userId })));
  },

  async accept(req, res) {
    res.json(view(await acceptRide({ tenant: req.tenant, rideId: req.valid.id, driver: req.user })));
  },

  async decline(req, res) {
    await declineRide({ tenantId: req.tenant._id, rideId: req.valid.id, driver: req.user });
    res.json({ ok: true });
  },

  arrive: (req, res) => step(req, res, 'arrive'),
  start: (req, res) => step(req, res, 'start'),
  finish: (req, res) => step(req, res, 'finish'),
  cancel: (req, res) => step(req, res, 'cancel'),

  async rate(req, res) {
    const { tenantId, userId } = ids(req);
    const { stars, comment } = req.valid;
    res.json(view(await rateRide({ tenantId, rideId: req.valid.id, actor: 'driver', userId, stars, comment })));
  },

  async messages(req, res) {
    const { tenantId, userId } = ids(req);
    res.json(await listMessages({ tenantId, rideId: req.valid.id, role: 'driver', userId, limit: req.valid.limit, before: req.valid.before }));
  },

  async sendMessage(req, res) {
    const { tenantId, userId } = ids(req);
    const message = await sendMessage({ tenantId, rideId: req.valid.id, role: 'driver', userId, text: req.valid.text });
    res.status(201).json({ message });
  },
};

async function step(req, res, action) {
  const { tenantId, userId } = ids(req);
  const ride = await transition({
    tenantId,
    rideId: req.valid.id,
    action,
    actor: 'driver',
    userId,
    reason: req.valid.reason,
    finish: action === 'finish' ? { tolls: req.valid.tolls ?? 0 } : undefined,
  });
  res.json(view(ride));
}
