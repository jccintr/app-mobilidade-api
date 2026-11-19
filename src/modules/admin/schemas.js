import { z } from 'zod';
import { DOCUMENT_TYPES, DRIVER_STATUSES } from '../../models/Driver.js';
import { email, name, objectId, password } from '../accounts/schemas.js';
import { fareInputSchema, pricingConfigSchema } from '../../pricing/schema.js';

export const idParamSchema = z.object({ id: objectId });
export const driverDocumentParamSchema = z.object({ id: objectId, type: z.enum(DOCUMENT_TYPES) });

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(60).optional(),
};

export const listDriversQuery = z.object({ ...pagination, status: z.enum(DRIVER_STATUSES).optional() });
export const listPassengersQuery = z.object({ ...pagination, status: z.enum(['active', 'blocked']).optional() });

export const adminLoginSchema = z.object({ email, password: z.string().min(1).max(72) });
export const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Explique o motivo.').max(300) });

// ---- regras de tarifa ----
export const createPricingRuleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(300).optional(),
  activate: z.boolean().default(false),
  config: pricingConfigSchema,
});

/** Simulação: usa uma regra salva (ruleId), a ativa (padrão) ou um rascunho enviado em `config`. */
export const simulateSchema = z.object({
  ruleId: objectId.optional(),
  config: pricingConfigSchema.optional(),
  input: fareInputSchema,
});

// ---- super admin ----
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Use de 3 a 40 letras minúsculas, números ou hífen.');

const city = z.object({
  ibgeCode: z.string().trim().optional(),
  name: z.string().trim().min(2),
  uf: z.string().trim().length(2).toUpperCase(),
});

const brand = z.object({
  displayName: z.string().trim().max(60).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.')
    .optional(),
  logoUrl: z.string().trim().url().max(300).optional(),
});

export const mapSchema = z.object({
  center: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  zoom: z.number().int().min(3).max(19).default(13),
});

const settings = z.object({
  requireDriverApproval: z.boolean().optional(),
  requireEmailVerification: z.boolean().optional(),
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug,
  timezone: z.string().trim().optional(),
  brand: brand.optional(),
  map: mapSchema.optional(),
  cities: z.array(city).max(50).optional(),
  settings: settings.optional(),
});

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    active: z.boolean(),
    timezone: z.string().trim(),
    brand,
    map: mapSchema,
    cities: z.array(city).max(50),
    settings,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');

export const createOperatorAdminSchema = z.object({ name, email, password });

// ---- cobrança dos motoristas (taxa por corrida + créditos via Pix) ----
const centsField = (max) => z.number().int('Use valores em centavos (inteiros).').min(0).max(max);
export const billingSettingsSchema = z
  .object({
    feeFixedCents: centsField(100_00),
    feePercent: z
      .number()
      .min(0)
      .max(100)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use no máximo 2 casas decimais.'),
    lowBalanceCents: centsField(1_000_00),
    welcomeCreditCents: centsField(1_000_00),
    // A chave chega como digitada e é validada/normalizada no controller (utils/pix.js). "" remove.
    pix: z
      .object({
        key: z.string().trim().max(140),
        keyType: z.enum(['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'RANDOM']).nullable(),
        receiverName: z.string().trim().max(60),
        city: z.string().trim().max(40),
      })
      .partial(),
    notifyEmail: z.union([email, z.literal('')]),
  })
  .partial();

// ---- configurações feitas pela própria operadora ----
export const updateSettingsSchema = z
  .object({
    billing: billingSettingsSchema,
    brand: z.object({
      displayName: z.string().trim().min(2).max(60),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.'),
    }).partial(),
    map: mapSchema,
    cities: z.array(city).max(50),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');
