import { z } from 'zod';
import { VEHICLE_TYPES } from '../../models/Driver.js';
import { RIDE_STATUSES } from '../../rides/stateMachine.js';
import { objectId } from '../accounts/schemas.js';

const lat = z.number().min(-90, 'Latitude inválida.').max(90, 'Latitude inválida.');
const lng = z.number().min(-180, 'Longitude inválida.').max(180, 'Longitude inválida.');
const place = z.object({ lat, lng, address: z.string().trim().max(200).optional() });

export const rideIdParam = z.object({ id: objectId });

export const estimateSchema = z.object({ pickup: place, dropoff: place });

export const requestRideSchema = z.object({
  pickup: place,
  dropoff: place,
  vehicleType: z.enum(VEHICLE_TYPES, { error: 'Tipo de veículo inválido.' }),
  paymentMethod: z.enum(['cash', 'pix_direct']).default('cash'),
});

export const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() });

/** Pedágio informado pelo motorista ao finalizar (entra no valor). Não há cobrança de espera. */
export const finishSchema = z.object({
  tolls: z.number().min(0).max(200).default(0),
});

export const rateSchema = z.object({
  stars: z.number().int().min(1, 'Nota de 1 a 5.').max(5, 'Nota de 1 a 5.'),
  comment: z.string().trim().max(300).optional(),
});

export const onlineSchema = z.object({ online: z.boolean(), lat: lat.optional(), lng: lng.optional() });
export const locationSchema = z.object({ lat, lng, heading: z.number().min(0).max(360).optional() });

export const messageSchema = z.object({ text: z.string().trim().min(1, 'Escreva a mensagem.').max(500) });
export const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.date().optional(),
});

export const listRidesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(RIDE_STATUSES).optional(),
  passengerId: objectId.optional(),
  driverId: objectId.optional(),
});

export const placesQuery = z.object({
  q: z.string().trim().min(2, 'Digite pelo menos 2 letras.').max(100),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  session: z.string().trim().max(64).optional(),
});
export const placeDetailsQuery = z.object({
  placeId: z.string().trim().min(3).max(300),
  session: z.string().trim().max(64).optional(),
});

export const conditionsSchema = z.object({ rain: z.boolean() });

export const directionsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
