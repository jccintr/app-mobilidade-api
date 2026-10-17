import { Ride } from '../../models/Ride.js';
import { buildQuotes } from '../../rides/quote.js';
import { listMessages, sendMessage } from '../../rides/chat.js';
import { createRide, findRideFor, rateRide, transition } from '../../rides/rideService.js';
import { serializeRide } from '../../rides/serialize.js';
import { ASSIGNED_STATUSES } from '../../rides/stateMachine.js';

const view = (ride) => ({ ride: serializeRide(ride, 'passenger') });
const ids = (req) => ({ tenantId: req.tenant._id, userId: req.user._id });

export const passengerRideController = {
  /** Valores das opções de veículo para um trajeto (nada é gravado). */
  async estimate(req, res) {
    const { pickup, dropoff } = req.valid;
    const { route, fares, rule } = await buildQuotes({ tenant: req.tenant, pickup, dropoff });
    res.json({
      route,
      ruleVersion: rule.version,
      quotes: Object.entries(fares).map(([vehicleType, fare]) => ({ vehicleType, fare })),
    });
  },

  async create(req, res) {
    const ride = await createRide({ tenant: req.tenant, passenger: req.user, body: req.valid });
    res.status(201).json(view(ride));
  },

  /** Corrida em curso (procurando motorista ou já atribuída). */
  async active(req, res) {
    const { tenantId, userId } = ids(req);
    const ride = await Ride.findOne({ tenantId, passengerId: userId, status: { $in: ['requested', ...ASSIGNED_STATUSES] } });
    res.json({ ride: ride ? serializeRide(ride, 'passenger') : null });
  },

  async list(req, res) {
    const { tenantId, userId } = ids(req);
    const { page, limit, status } = req.valid;
    const filter = { tenantId, passengerId: userId, ...(status ? { status } : {}) };
    const [rides, total] = await Promise.all([
      Ride.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Ride.countDocuments(filter),
    ]);
    res.json({ data: rides.map((ride) => serializeRide(ride, 'passenger')), page, limit, total, totalPages: Math.ceil(total / limit) });
  },

  async get(req, res) {
    const { tenantId, userId } = ids(req);
    res.json(view(await findRideFor({ tenantId, rideId: req.valid.id, role: 'passenger', userId })));
  },

  async cancel(req, res) {
    const { tenantId, userId } = ids(req);
    const ride = await transition({ tenantId, rideId: req.valid.id, action: 'cancel', actor: 'passenger', userId, reason: req.valid.reason });
    res.json(view(ride));
  },

  async rate(req, res) {
    const { tenantId, userId } = ids(req);
    const { stars, comment } = req.valid;
    const ride = await rateRide({ tenantId, rideId: req.valid.id, actor: 'passenger', userId, stars, comment });
    res.json(view(ride));
  },

  async messages(req, res) {
    const { tenantId, userId } = ids(req);
    res.json(await listMessages({ tenantId, rideId: req.valid.id, role: 'passenger', userId, limit: req.valid.limit, before: req.valid.before }));
  },

  async sendMessage(req, res) {
    const { tenantId, userId } = ids(req);
    const message = await sendMessage({ tenantId, rideId: req.valid.id, role: 'passenger', userId, text: req.valid.text });
    res.status(201).json({ message });
  },
};
