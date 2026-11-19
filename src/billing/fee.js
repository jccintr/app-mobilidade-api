/**
 * Taxa da operadora por corrida (funções puras, sem banco).
 *
 * A operadora pode cobrar um valor fixo, um percentual ou os dois juntos. O percentual incide sobre o
 * valor da corrida SEM pedágio (pedágio é custo repassado pelo motorista). A taxa nunca passa do valor
 * da corrida. Tudo em centavos; o percentual aceita até 2 casas decimais (ex.: 12.5).
 *
 * O motorista paga a taxa com créditos pré-pagos: ela é descontada do saldo dele no momento do aceite.
 */

/** Configuração de cobrança da operadora com os valores padrão (tudo zerado = cobrança desligada). */
export function billingConfig(tenant) {
  const billing = tenant?.billing ?? {};
  return {
    feeFixedCents: Math.max(0, Math.round(billing.feeFixedCents ?? 0)),
    feePercent: Math.max(0, Math.min(100, Number(billing.feePercent ?? 0))),
    lowBalanceCents: Math.max(0, Math.round(billing.lowBalanceCents ?? 0)),
    welcomeCreditCents: Math.max(0, Math.round(billing.welcomeCreditCents ?? 0)),
  };
}

/** Cobrança ligada = existe taxa fixa ou percentual. Desligada, ninguém precisa de saldo. */
export const isBillingEnabled = (config) => config.feeFixedCents > 0 || config.feePercent > 0;

/**
 * Calcula a taxa de uma corrida.
 * @param {number} baseCents valor da corrida sem pedágio, em centavos
 * @param {{ feeFixedCents: number, feePercent: number }} config
 */
export function computeRideFee(baseCents, { feeFixedCents = 0, feePercent = 0 } = {}) {
  const base = Math.max(0, Math.round(baseCents));
  const fixedCents = Math.max(0, Math.round(feeFixedCents));
  const percent = Math.max(0, Math.min(100, Number(feePercent) || 0));
  const percentCents = Math.round((base * percent) / 100);
  const totalCents = Math.min(base, fixedCents + percentCents);
  return { baseCents: base, fixedCents, percent, percentCents, totalCents };
}

/** Quanto o motorista fica da corrida depois da taxa (inclui o pedágio, que é dele). */
export const driverNetCents = (totalCents, feeCents) => Math.max(0, Math.round(totalCents) - Math.round(feeCents ?? 0));
