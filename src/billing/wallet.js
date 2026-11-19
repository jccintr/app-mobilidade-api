import { Driver } from '../models/Driver.js';
import { WalletEntry } from '../models/WalletEntry.js';
import { sendPush } from '../services/push.js';
import { billingConfig } from './fee.js';

/**
 * Movimentações do saldo de créditos do motorista (mesmo padrão do Delivroo Express, utils/credits.js).
 *
 * O saldo fica no motorista (wallet.balanceCents) e cada movimentação vira uma linha no extrato (WalletEntry).
 * São duas gravações sem transação (o Mongo pode estar sem replica set): primeiro o $inc atômico no saldo,
 * depois a linha do extrato. Se a linha for recusada pelo índice único (lançamento repetido), o $inc é desfeito.
 */

const isDuplicateKey = (error) => error?.code === 11000;
const formatBRL = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Aplica uma movimentação. Saídas (valor negativo) só acontecem se houver saldo suficiente.
 * @returns {Promise<{ entry, balanceCents, previousCents } | { duplicate: true } | null>}
 *          null = sem saldo (saída) ou motorista não encontrado
 */
export async function applyWalletEntry({ tenantId, driverId, type, amountCents, rideId, purchaseId, adminId, note }) {
  const amount = Math.round(amountCents);
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Valor de movimentação inválido.');

  const filter = { _id: driverId, tenantId };
  if (amount < 0) filter['wallet.balanceCents'] = { $gte: -amount };

  const driver = await Driver.findOneAndUpdate(filter, { $inc: { 'wallet.balanceCents': amount } }, { returnDocument: 'after' }).select(
    'wallet pushToken',
  );
  if (!driver) return null;

  const balanceCents = driver.wallet?.balanceCents ?? 0;
  try {
    const entry = await WalletEntry.create({
      tenantId,
      driverId,
      type,
      amountCents: amount,
      balanceAfterCents: balanceCents,
      rideId,
      purchaseId,
      adminId,
      note,
    });
    return { entry, balanceCents, previousCents: balanceCents - amount, pushToken: driver.pushToken };
  } catch (error) {
    // Lançamento repetido (mesma compra/corrida/boas-vindas): desfaz o $inc e avisa quem chamou.
    await Driver.updateOne({ _id: driverId }, { $inc: { 'wallet.balanceCents': -amount } });
    if (isDuplicateKey(error)) return { duplicate: true };
    throw error;
  }
}

/** Desfaz uma movimentação recém-criada (usado quando o passo seguinte falha, ex.: o aceite não pegou). */
export async function revertWalletEntry(entry) {
  await WalletEntry.deleteOne({ _id: entry._id });
  await Driver.updateOne({ _id: entry.driverId }, { $inc: { 'wallet.balanceCents': -entry.amountCents } });
}

/** Push quando o saldo cruza para baixo do limite de "saldo baixo" configurado pela operadora. */
export function warnLowBalance({ tenant, result }) {
  const { lowBalanceCents } = billingConfig(tenant);
  if (!lowBalanceCents || !result?.entry) return;
  if (result.previousCents >= lowBalanceCents && result.balanceCents < lowBalanceCents) {
    sendPush(result.pushToken, {
      title: 'Saldo baixo',
      body: `Seu saldo de créditos está em ${formatBRL(result.balanceCents)}. Compre créditos para continuar recebendo corridas.`,
      data: { type: 'wallet:low' },
      ttl: 6 * 3600,
      channelId: 'ofertas',
    }).catch(() => {});
  }
}

/**
 * Crédito de boas-vindas (uma vez por motorista, garantido pelo índice "welcome_once").
 * Chamado na aprovação do cadastro e no botão "dar boas-vindas aos já aprovados".
 * @returns {Promise<boolean>} true se creditou agora
 */
export async function grantWelcomeCredit({ tenant, driverId, adminId }) {
  const { welcomeCreditCents } = billingConfig(tenant);
  if (!welcomeCreditCents) return false;
  const result = await applyWalletEntry({
    tenantId: tenant._id,
    driverId,
    type: 'welcome',
    amountCents: welcomeCreditCents,
    adminId,
    note: 'Crédito de boas-vindas',
  });
  if (!result?.entry) return false;
  await Driver.updateOne({ _id: driverId }, { $set: { 'wallet.welcomeGrantedAt': new Date() } });
  return true;
}
