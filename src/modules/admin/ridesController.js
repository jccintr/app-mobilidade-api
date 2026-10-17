import { Driver } from '../../models/Driver.js';
import { Passenger } from '../../models/Passenger.js';
import { Ride } from '../../models/Ride.js';
import { localTimeParts } from '../../pricing/engine.js';
import { fromPoint } from '../../utils/geo.js';
import { Tenant } from '../../models/Tenant.js';
import { invalidateTenantCache } from '../../middlewares/tenant.js';
import { serializeRide } from '../../rides/serialize.js';
import { notFound } from '../../utils/errors.js';

export const ridesAdminController = {
  async list(req, res) {
    const { page, limit, status, passengerId, driverId } = req.valid;
    const filter = {
      tenantId: req.tenant._id,
      ...(status ? { status } : {}),
      ...(passengerId ? { passengerId } : {}),
      ...(driverId ? { driverId } : {}),
    };
    const [rides, total] = await Promise.all([
      Ride.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Ride.countDocuments(filter),
    ]);
    res.json({ data: rides.map((ride) => serializeRide(ride, 'admin')), page, limit, total, totalPages: Math.ceil(total / limit) });
  },

  async get(req, res) {
    const ride = await Ride.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
    if (!ride) throw notFound('RIDE_NOT_FOUND', 'Corrida não encontrada.');
    res.json({ ride: serializeRide(ride, 'admin') });
  },

  /** Liga/desliga condições que entram na tarifa (ex.: "chuva" aciona o adicional de chuva). */
  async getConditions(req, res) {
    res.json({ conditions: { rain: Boolean(req.tenant.conditions?.rain) } });
  },

  async setConditions(req, res) {
    const tenant = await Tenant.findByIdAndUpdate(req.tenant._id, { $set: { 'conditions.rain': req.valid.rain } }, { returnDocument: 'after' });
    invalidateTenantCache(req.tenant.slug);
    res.json({ conditions: { rain: Boolean(tenant.conditions?.rain) } });
  },

  /** Números do início do painel. "Hoje" segue o fuso horário da operadora. */
  async dashboard(req, res) {
    const tenantId = req.tenant._id;
    const tz = req.tenant.timezone || 'America/Sao_Paulo';
    const now = new Date();
    const local = localTimeParts(now, tz);
    const startOfToday = new Date(now.getTime() - local.minutesOfDay * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());

    const [driversByStatus, driversOnline, passengers, today] = await Promise.all([
      Driver.aggregate([{ $match: { tenantId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Driver.countDocuments({ tenantId, online: true }),
      Passenger.countDocuments({ tenantId }),
      Ride.aggregate([
        { $match: { tenantId, createdAt: { $gte: startOfToday } } },
        { $group: { _id: '$status', count: { $sum: 1 }, cents: { $sum: '$totalCents' } } },
      ]),
    ]);

    const drivers = Object.fromEntries(driversByStatus.map((row) => [row._id, row.count]));
    const rides = Object.fromEntries(today.map((row) => [row._id, row.count]));
    res.json({
      rain: Boolean(req.tenant.conditions?.rain),
      drivers: { ...drivers, online: driversOnline },
      passengers,
      ridesToday: {
        total: today.reduce((sum, row) => sum + row.count, 0),
        byStatus: rides,
        revenue: (today.find((row) => row._id === 'completed')?.cents ?? 0) / 100,
      },
    });
  },

  /** Foto do mapa ao vivo: motoristas online com a última posição e corridas em aberto. */
  async live(req, res) {
    const tenantId = req.tenant._id;
    const [drivers, rides, busyIds] = await Promise.all([
      Driver.find({ tenantId, online: true, 'location.coordinates.0': { $exists: true } }),
      Ride.find({ tenantId, status: { $in: ['requested', 'accepted', 'arrived', 'in_progress'] } }).sort({ createdAt: -1 }).limit(200),
      Ride.distinct('activeDriverId', { tenantId, activeDriverId: { $ne: null } }),
    ]);
    const busy = new Set(busyIds.map(String));
    res.json({
      drivers: drivers.map((driver) => ({
        id: String(driver._id),
        name: driver.name,
        avatarUrl: driver.toJSON().avatarUrl,
        vehicle: driver.vehicle,
        ratingAvg: driver.ratingAvg ?? 0,
        busy: busy.has(String(driver._id)),
        position: fromPoint(driver.location),
        positionAt: driver.locationUpdatedAt,
      })),
      rides: rides.map((ride) => {
        const json = serializeRide(ride, 'admin');
        return { ...json, pickupPoint: fromPoint(ride.pickup.location), dropoffPoint: fromPoint(ride.dropoff.location) };
      }),
    });
  },
};
