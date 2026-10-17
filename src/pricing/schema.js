import { z } from 'zod';

/**
 * Formato das regras de tarifa (editável no painel da operadora).
 * Valores em reais (ex.: 2.2 = R$ 2,20). O motor converte tudo para centavos.
 *
 * Convenções:
 *  - weekdays: 0 = domingo ... 6 = sábado, no fuso da regra (timezone).
 *  - Horário/dia/data valem para o instante em que a corrida foi pedida.
 *  - Em `when`, todas as condições informadas precisam ser verdadeiras (E).
 *    `zones` casa se QUALQUER uma das zonas da corrida estiver na lista.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM (00:00 a 23:59).');
const money = z.number().finite().min(0).max(100_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');

export const VEHICLE_TYPES = ['car'];

const vehicleTariff = z
  .object({
    baseFare: money, // bandeirada
    perKm: money,
    perMinute: money,
    minimumFare: money,
  })
  .strict();

const condition = z
  .object({
    timeRange: z.object({ from: hhmm, to: hhmm }).strict().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    dates: z.array(isoDate).min(1).max(400).optional(),
    rain: z.boolean().optional(),
    zones: z.array(z.string().min(1).max(40)).min(1).max(50).optional(),
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1).optional(),
  })
  .strict();

const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: z.number().finite().min(-90).max(500) }).strict(),
  z.object({ type: z.literal('fixed'), value: z.number().finite().min(-1000).max(10_000) }).strict(),
]);

const adjustment = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Use letras minúsculas, números, - ou _.'),
    label: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    when: condition.default({}),
    effect,
  })
  .strict();

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const pricingConfigSchema = z
  .object({
    currency: z.literal('BRL').default('BRL'),
    timezone: z.string().refine(isValidTimezone, 'Fuso horário inválido.').default('America/Sao_Paulo'),
    // Chaves antigas (ex.: de regras salvas quando havia outros veículos) são ignoradas.
    vehicleTariffs: z.object({ car: vehicleTariff }),
    adjustments: z.array(adjustment).max(60).default([]),
    extras: z
      .object({
        waitPerMinute: money.default(0),
        perStop: money.default(0),
      })
      .strict()
      .default({ waitPerMinute: 0, perStop: 0 }),
    limits: z
      .object({
        // Soma máxima/mínima de todos os adicionais percentuais (em %).
        maxPercentTotal: z.number().min(0).max(1000).default(200),
        minPercentTotal: z.number().min(-90).max(0).default(-50),
      })
      .strict()
      .default({ maxPercentTotal: 200, minPercentTotal: -50 }),
    rounding: z
      .object({
        step: z.number().min(0.01).max(10).default(0.1),
        mode: z.enum(['nearest', 'up']).default('nearest'),
      })
      .strict()
      .default({ step: 0.1, mode: 'nearest' }),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set();
    config.adjustments.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', path: ['adjustments', index, 'id'], message: `Id repetido: ${item.id}` });
      }
      seen.add(item.id);
    });
  });

/** Dados de uma corrida a precificar. */
export const fareInputSchema = z
  .object({
    vehicleType: z.enum(VEHICLE_TYPES),
    distanceKm: z.number().finite().min(0).max(5000),
    durationMin: z.number().finite().min(0).max(5000),
    requestedAt: z.coerce.date().optional(),
    rain: z.boolean().default(false),
    zones: z.array(z.string().min(1).max(40)).max(20).default([]),
    waitMinutes: z.number().finite().min(0).max(1000).default(0),
    stops: z.number().int().min(0).max(20).default(0),
    tolls: z.number().finite().min(0).max(10_000).default(0), // pedágio/balsa em reais
  })
  .strict();
