import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { CreditPurchase } from '../../models/CreditPurchase.js';
import { buildPixPayload, normalizeStoredPixKey } from '../../utils/pix.js';

/** Funções compartilhadas pelas rotas do motorista e do admin. */

// Sem 0/O/1/I/L: o código é lido e digitado por pessoas.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePurchaseCode() {
  let code = 'C';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * Dados do Pix da operadora prontos para o BR Code, ou null se ainda não configurados.
 * (Chave, nome e cidade são obrigatórios no QR; o nome cai para o nome da operadora.)
 */
export function tenantPix(tenant) {
  const pix = tenant?.billing?.pix;
  if (!pix?.key || !pix?.city) return null;
  const normalized = normalizeStoredPixKey(pix.key);
  if (!normalized.ok) return null;
  return {
    key: normalized.key,
    name: pix.receiverName || tenant.brand?.displayName || tenant.name,
    city: pix.city,
  };
}

export const pixPayloadFor = (pix, { amountCents, code }) => buildPixPayload({ ...pix, amountCents, txid: code });

/**
 * Pedidos "pending" vencidos viram "expired" (sem agendador: roda antes de cada leitura/criação).
 * O filtro limita o alcance (uma operadora, um motorista).
 */
export async function expireStalePurchases(filter) {
  const now = new Date();
  await CreditPurchase.updateMany(
    { ...filter, status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired', open: false, expiredAt: now } },
  );
}

/** Forma pública da compra. O QR (PNG em data URL) é desenhado na hora, só enquanto aguarda pagamento. */
export async function serializePurchase(purchase, { withQr = false } = {}) {
  const json = purchase.toJSON();
  const awaiting = json.status === 'pending' || json.status === 'informed';
  if (!awaiting) delete json.pixPayload;
  if (withQr && awaiting) {
    json.qrCodeDataUrl = await QRCode.toDataURL(purchase.pixPayload, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
  }
  return json;
}
