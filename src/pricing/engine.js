import { fareInputSchema, pricingConfigSchema } from './schema.js';

/**
 * Motor de preço: função pura (sem banco, sem relógio, sem rede).
 * Todo o cálculo é feito em CENTAVOS inteiros para não acumular erro de ponto flutuante.
 *
 * Ordem do cálculo:
 *   1. Corrida: bandeirada + km × valor/km + minutos × valor/min
 *   2. Tarifa mínima (se a corrida ficou abaixo)
 *   3. Adicionais percentuais (somados, não compostos), limitados por `limits`
 *   4. Adicionais fixos (taxas de zona etc.)
 *   5. Extras (espera, paradas, pedágio)
 *   6. Arredondamento
 * Cada passo vira uma linha em `lines`, para o passageiro/motorista/admin enxergarem a conta.
 */

export class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Hora, dia da semana e data no fuso da operadora. */
export function localTimeParts(date, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    weekday: WEEKDAY_INDEX[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: hour * 60 + minute,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function inTimeRange(minutesOfDay, { from, to }) {
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (start === end) return true; // 00:00–00:00 = o dia todo
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  return minutesOfDay >= start || minutesOfDay < end; // atravessa a meia-noite (ex.: 22:00–05:00)
}

function matches(when, ctx) {
  if (when.timeRange && !inTimeRange(ctx.local.minutesOfDay, when.timeRange)) return false;
  if (when.weekdays && !when.weekdays.includes(ctx.local.weekday)) return false;
  if (when.dates && !when.dates.includes(ctx.local.date)) return false;
  if (when.rain !== undefined && when.rain !== ctx.rain) return false;
  if (when.zones && !when.zones.some((zone) => ctx.zones.includes(zone))) return false;
  if (when.vehicleTypes && !when.vehicleTypes.includes(ctx.vehicleType)) return false;
  return true;
}

const cents = (reais) => Math.round(reais * 100);
const reais = (value) => value / 100;

function line(code, label, amountCents, extra = {}) {
  return { code, label, amountCents, amount: reais(amountCents), ...extra };
}

/**
 * @param {object} rawConfig  regra de tarifa (formato de schema.js)
 * @param {object} rawInput   dados da corrida
 * @returns {{ currency, vehicleType, total, totalCents, lines, appliedAdjustments, context }}
 */
export function calculateFare(rawConfig, rawInput) {
  const config = pricingConfigSchema.parse(rawConfig);
  const input = fareInputSchema.parse(rawInput);

  const tariff = config.vehicleTariffs[input.vehicleType];
  if (!tariff) {
    throw new PricingError('VEHICLE_NOT_SUPPORTED', `Este tipo de veículo não tem tarifa configurada: ${input.vehicleType}.`);
  }

  const requestedAt = input.requestedAt ?? new Date();
  const local = localTimeParts(requestedAt, config.timezone);
  const ctx = { local, rain: input.rain, zones: input.zones, vehicleType: input.vehicleType };

  const lines = [];
  const applied = [];

  // 1. Corrida
  const base = cents(tariff.baseFare);
  const distance = Math.round(input.distanceKm * tariff.perKm * 100);
  const time = Math.round(input.durationMin * tariff.perMinute * 100);
  lines.push(line('base', 'Bandeirada', base));
  lines.push(line('distance', `Distância (${input.distanceKm} km)`, distance, { quantity: input.distanceKm, unit: 'km' }));
  lines.push(line('time', `Tempo (${input.durationMin} min)`, time, { quantity: input.durationMin, unit: 'min' }));
  let tripCents = base + distance + time;

  // 2. Tarifa mínima
  const minimum = cents(tariff.minimumFare);
  if (tripCents < minimum) {
    lines.push(line('minimum_fare', 'Ajuste para tarifa mínima', minimum - tripCents));
    tripCents = minimum;
  }

  // 3. Adicionais percentuais (somados sobre o valor da corrida)
  const active = config.adjustments.filter((item) => item.enabled && matches(item.when, ctx));
  const percentItems = active.filter((item) => item.effect.type === 'percent');
  let percentSum = 0;
  let percentAmount = 0;
  for (const item of percentItems) {
    const amount = Math.round((tripCents * item.effect.value) / 100);
    percentSum += item.effect.value;
    percentAmount += amount;
    applied.push(item.id);
    lines.push(line(item.id, item.label, amount, { percent: item.effect.value }));
  }
  if (percentItems.length) {
    const clampedPercent = Math.min(config.limits.maxPercentTotal, Math.max(config.limits.minPercentTotal, percentSum));
    if (clampedPercent !== percentSum) {
      const clampedAmount = Math.round((tripCents * clampedPercent) / 100);
      lines.push(line('percent_limit', 'Ajuste pelo limite de adicionais', clampedAmount - percentAmount));
      percentAmount = clampedAmount;
    }
  }

  // 4. Adicionais fixos
  let fixedAmount = 0;
  for (const item of active.filter((entry) => entry.effect.type === 'fixed')) {
    const amount = cents(item.effect.value);
    fixedAmount += amount;
    applied.push(item.id);
    lines.push(line(item.id, item.label, amount));
  }

  // 5. Extras
  let extrasAmount = 0;
  if (input.waitMinutes > 0 && config.extras.waitPerMinute > 0) {
    const amount = Math.round(input.waitMinutes * config.extras.waitPerMinute * 100);
    extrasAmount += amount;
    lines.push(line('wait', `Espera (${input.waitMinutes} min)`, amount, { quantity: input.waitMinutes, unit: 'min' }));
  }
  if (input.stops > 0 && config.extras.perStop > 0) {
    const amount = Math.round(input.stops * config.extras.perStop * 100);
    extrasAmount += amount;
    lines.push(line('stops', `Paradas (${input.stops})`, amount, { quantity: input.stops, unit: 'parada' }));
  }
  if (input.tolls > 0) {
    const amount = cents(input.tolls);
    extrasAmount += amount;
    lines.push(line('tolls', 'Pedágio / balsa', amount));
  }

  let totalCents = tripCents + percentAmount + fixedAmount + extrasAmount;
  if (totalCents < 0) {
    lines.push(line('floor', 'Ajuste: valor não pode ser negativo', -totalCents));
    totalCents = 0;
  }

  // 6. Arredondamento
  const stepCents = Math.max(1, cents(config.rounding.step));
  const steps = totalCents / stepCents;
  const roundedCents = (config.rounding.mode === 'up' ? Math.ceil(steps - 1e-9) : Math.round(steps)) * stepCents;
  if (roundedCents !== totalCents) {
    lines.push(line('rounding', 'Arredondamento', roundedCents - totalCents));
    totalCents = roundedCents;
  }

  return {
    currency: config.currency,
    vehicleType: input.vehicleType,
    total: reais(totalCents),
    totalCents,
    lines,
    appliedAdjustments: applied,
    context: {
      timezone: config.timezone,
      localDate: local.date,
      localTime: local.time,
      weekday: local.weekday,
    },
  };
}
