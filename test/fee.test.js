import test from 'node:test';
import assert from 'node:assert/strict';
import { billingConfig, computeRideFee, driverNetCents, isBillingEnabled } from '../src/billing/fee.js';

test('taxa: só percentual (10% de R$ 25,00 = R$ 2,50)', () => {
  assert.deepEqual(computeRideFee(2500, { feePercent: 10 }), { baseCents: 2500, fixedCents: 0, percent: 10, percentCents: 250, totalCents: 250 });
});

test('taxa: só valor fixo', () => {
  assert.equal(computeRideFee(2500, { feeFixedCents: 150 }).totalCents, 150);
});

test('taxa: fixo + percentual juntos (R$ 1,00 + 10% de R$ 25,00 = R$ 3,50)', () => {
  const fee = computeRideFee(2500, { feeFixedCents: 100, feePercent: 10 });
  assert.equal(fee.totalCents, 350);
  assert.equal(driverNetCents(2500, fee.totalCents), 2150);
});

test('taxa: percentual com decimais arredonda para o centavo', () => {
  assert.equal(computeRideFee(1999, { feePercent: 12.5 }).percentCents, 250); // 249,875 -> 250
  assert.equal(computeRideFee(1001, { feePercent: 10 }).percentCents, 100); // 100,1 -> 100
});

test('taxa: nunca passa do valor da corrida', () => {
  assert.equal(computeRideFee(300, { feeFixedCents: 500, feePercent: 10 }).totalCents, 300);
});

test('taxa: líquido do motorista inclui o pedágio (que fica fora da base da taxa)', () => {
  const fee = computeRideFee(2000, { feePercent: 10 }); // R$ 2,00 sobre R$ 20,00
  assert.equal(driverNetCents(2000 + 650, fee.totalCents), 2450); // corrida + R$ 6,50 de pedágio - taxa
});

test('cobrança: desligada com tudo zerado; configuração com padrões seguros', () => {
  assert.equal(isBillingEnabled(billingConfig({})), false);
  assert.equal(isBillingEnabled(billingConfig({ billing: { feePercent: 5 } })), true);
  assert.equal(isBillingEnabled(billingConfig({ billing: { feeFixedCents: 100 } })), true);
  assert.deepEqual(billingConfig({ billing: { feePercent: 150, feeFixedCents: -5 } }), {
    feeFixedCents: 0,
    feePercent: 100,
    lowBalanceCents: 0,
    welcomeCreditCents: 0,
  });
});
