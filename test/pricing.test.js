import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare, localTimeParts, PricingError } from '../src/pricing/engine.js';
import { exampleRule } from '../src/pricing/exampleRule.js';

// Regra de exemplo com arredondamento de 1 centavo (para os testes ficarem legíveis).
const rule = (patch = {}) => ({
  ...structuredClone(exampleRule),
  rounding: { step: 0.01, mode: 'nearest' },
  ...patch,
});

// Quarta-feira, 12:00 em São Paulo (UTC-3)
const MIDDAY = '2026-10-14T15:00:00Z';
const trip = { vehicleType: 'car', distanceKm: 5, durationMin: 15, requestedAt: MIDDAY };

const lineOf = (result, code) => result.lines.find((item) => item.code === code);

describe('fuso horário', () => {
  it('converte UTC para o horário local da operadora', () => {
    const parts = localTimeParts(new Date('2026-10-15T01:30:00Z'), 'America/Sao_Paulo');
    assert.equal(parts.date, '2026-10-14');
    assert.equal(parts.time, '22:30');
    assert.equal(parts.weekday, 3); // quarta
  });

  it('meia-noite local é 00:00 (não 24:00)', () => {
    const parts = localTimeParts(new Date('2026-10-15T03:00:00Z'), 'America/Sao_Paulo');
    assert.equal(parts.time, '00:00');
    assert.equal(parts.date, '2026-10-15');
  });
});

describe('corrida base', () => {
  it('soma bandeirada + distância + tempo', () => {
    const result = calculateFare(rule(), trip);
    // 4,00 + 5 km × 2,20 + 15 min × 0,35 = 4,00 + 11,00 + 5,25
    assert.equal(result.totalCents, 2025);
    assert.equal(result.total, 20.25);
    assert.equal(lineOf(result, 'base').amountCents, 400);
    assert.equal(lineOf(result, 'distance').amountCents, 1100);
    assert.equal(lineOf(result, 'time').amountCents, 525);
    assert.deepEqual(result.appliedAdjustments, []);
  });

  it('aplica a tarifa mínima', () => {
    const result = calculateFare(rule(), { ...trip, distanceKm: 0.5, durationMin: 2 });
    // 4,00 + 1,10 + 0,70 = 5,80 -> mínima 8,00
    assert.equal(lineOf(result, 'minimum_fare').amountCents, 220);
    assert.equal(result.totalCents, 800);
  });

  it('recusa tipo de veículo que a plataforma não atende', () => {
    assert.throws(() => calculateFare(rule(), { ...trip, vehicleType: 'moto' }));
  });

  it('vale às 04:59 e deixa de valer às 05:00 (horário local)', () => {
    const at0459 = calculateFare(rule(), { ...trip, requestedAt: '2026-10-14T07:59:00Z' });
    const at0500 = calculateFare(rule(), { ...trip, requestedAt: '2026-10-14T08:00:00Z' });
    assert.ok(at0459.appliedAdjustments.includes('night'));
    assert.ok(!at0500.appliedAdjustments.includes('night'));
  });

  it('adicional de domingo', () => {
    const result = calculateFare(rule(), { ...trip, requestedAt: '2026-10-18T15:00:00Z' });
    assert.ok(result.appliedAdjustments.includes('sunday'));
    assert.equal(result.totalCents, 2228); // 2025 + 10% (202,5 -> 203)
  });

  it('adicional em data específica (feriado)', () => {
    const result = calculateFare(rule(), { ...trip, requestedAt: '2026-12-25T15:00:00Z' });
    assert.ok(result.appliedAdjustments.includes('christmas'));
    assert.equal(result.totalCents, 2633); // 2025 + 30% (607,5 -> 608)
  });
});

describe('chuva, zonas e extras', () => {
  it('chuva só entra quando informada', () => {
    const dry = calculateFare(rule(), trip);
    const wet = calculateFare(rule(), { ...trip, rain: true });
    assert.ok(!dry.appliedAdjustments.includes('rain'));
    assert.ok(wet.appliedAdjustments.includes('rain'));
    assert.equal(wet.totalCents, 2025 + 304); // 15% de 20,25 = 3,04
  });

  it('taxa fixa por zona', () => {
    const result = calculateFare(rule(), { ...trip, zones: ['rodoviaria'] });
    assert.equal(result.totalCents, 2325);
  });

  it('zona desconhecida não gera taxa', () => {
    const result = calculateFare(rule(), { ...trip, zones: ['centro'] });
    assert.equal(result.totalCents, 2025);
  });

  it('espera, paradas e pedágio', () => {
    const result = calculateFare(rule(), { ...trip, waitMinutes: 4, stops: 2, tolls: 6.5 });
    // 20,25 + 4 × 0,50 + 2 × 2,00 + 6,50
    assert.equal(result.totalCents, 3275);
  });

  it('adicional desativado não é aplicado', () => {
    const config = rule();
    config.adjustments = config.adjustments.map((item) => (item.id === 'night' ? { ...item, enabled: false } : item));
    const result = calculateFare(config, { ...trip, requestedAt: '2026-10-15T01:30:00Z' });
    assert.ok(!result.appliedAdjustments.includes('night'));
    assert.equal(result.totalCents, 2025);
  });
});

describe('limites e arredondamento', () => {
  it('limita a soma dos adicionais percentuais e explica a diferença', () => {
    const config = rule({ limits: { maxPercentTotal: 30, minPercentTotal: -50 } });
    const result = calculateFare(config, { ...trip, requestedAt: '2026-10-15T01:30:00Z', rain: true });
    // noite (20%) + chuva (15%) = 35% -> limitado a 30%
    assert.ok(lineOf(result, 'percent_limit'));
    assert.equal(result.totalCents, 2025 + 608);
  });

  it('arredonda para o múltiplo mais próximo', () => {
    const config = rule({ rounding: { step: 0.5, mode: 'nearest' } });
    const result = calculateFare(config, { ...trip, durationMin: 12 }); // 19,20
    assert.equal(result.total, 19);
  });

  it('arredonda sempre para cima quando configurado', () => {
    const config = rule({ rounding: { step: 0.5, mode: 'up' } });
    const result = calculateFare(config, { ...trip, durationMin: 12 }); // 19,20
    assert.equal(result.total, 19.5);
  });

  it('a soma das linhas sempre fecha com o total', () => {
    const config = rule({ rounding: { step: 0.5, mode: 'nearest' }, limits: { maxPercentTotal: 40, minPercentTotal: -50 } });
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 500; i++) {
      const input = {
        vehicleType: 'car',
        distanceKm: Math.round(random() * 400) / 10,
        durationMin: Math.round(random() * 900) / 10,
        requestedAt: new Date(Date.UTC(2026, 9, 1 + Math.floor(random() * 90), Math.floor(random() * 24), Math.floor(random() * 60))),
        rain: random() > 0.5,
        zones: random() > 0.7 ? ['rodoviaria'] : [],
        waitMinutes: Math.round(random() * 10),
        stops: Math.floor(random() * 3),
        tolls: random() > 0.8 ? 5 : 0,
      };
      const result = calculateFare(config, input);
      const sum = result.lines.reduce((acc, item) => acc + item.amountCents, 0);
      assert.equal(sum, result.totalCents, `linhas não fecham para ${JSON.stringify(input)}`);
      assert.ok(result.totalCents >= 0);
    }
  });
});

describe('validação', () => {
  it('rejeita distância negativa', () => {
    assert.throws(() => calculateFare(rule(), { ...trip, distanceKm: -1 }));
  });

  it('rejeita campos desconhecidos na corrida', () => {
    assert.throws(() => calculateFare(rule(), { ...trip, surprise: true }));
  });

  it('rejeita ids de adicional repetidos', () => {
    const config = rule();
    config.adjustments.push({ ...config.adjustments[0] });
    assert.throws(() => calculateFare(config, trip));
  });

  it('rejeita horário inválido', () => {
    const config = rule();
    config.adjustments[0].when.timeRange = { from: '25:00', to: '05:00' };
    assert.throws(() => calculateFare(config, trip));
  });

  it('rejeita fuso horário inválido', () => {
    assert.throws(() => calculateFare(rule({ timezone: 'Marte/Olympus' }), trip));
  });
});
