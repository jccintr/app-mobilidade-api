import { z } from 'zod';
import { objectId } from '../accounts/schemas.js';
import { PURCHASE_STATUSES } from '../../models/CreditPurchase.js';

const cents = (min, max) => z.number().int('Use valores em centavos (inteiros).').min(min).max(max);
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

export const idParam = z.object({ id: objectId });
export const pageQuery = z.object({ page, limit });

export const createPurchaseSchema = z.object({ packageId: objectId });

/** "Já paguei" (multipart): observação opcional; o comprovante vem no arquivo "receipt", também opcional. */
export const informSchema = z.object({ payerNote: z.string().trim().max(200).optional() });

// ---- admin ----
export const packageSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do pacote.').max(60),
    priceCents: cents(100, 10_000_00),
    creditCents: cents(100, 20_000_00),
    active: z.boolean().default(true),
  })
  .refine((value) => value.creditCents >= value.priceCents, {
    message: 'O crédito não pode ser menor que o preço do pacote.',
    path: ['creditCents'],
  });

export const updatePackageSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    priceCents: cents(100, 10_000_00),
    creditCents: cents(100, 20_000_00),
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');

export const listPurchasesQuery = z.object({
  status: z.enum(['open', ...PURCHASE_STATUSES]).optional(),
  driverId: objectId.optional(),
  page,
  limit,
});

export const rejectPurchaseSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo.').max(200) });

export const adjustWalletSchema = z.object({
  amountCents: z
    .number()
    .int('Use valores em centavos (inteiros).')
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'O ajuste não pode ser zero.'),
  note: z.string().trim().min(3, 'Explique o motivo do ajuste.').max(200),
});
