import { z } from 'zod';
import { DOCUMENT_TYPES, VEHICLE_TYPES } from '../../models/Driver.js';

export const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(120);
export const password = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(72, 'A senha pode ter no máximo 72 caracteres.');
export const name = z.string().trim().min(2, 'Informe o nome.').max(80, 'Nome muito longo.');
export const phone = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => value.length >= 10 && value.length <= 13, 'Telefone inválido. Use DDD + número.');
export const code = z.string().trim().regex(/^\d{6}$/, 'Código inválido.');
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identificador inválido.');

export const registerSchema = z.object({ name, email, phone, password });
export const loginSchema = z.object({ email, password: z.string().min(1, 'Informe a senha.').max(72) });
export const emailOnlySchema = z.object({ email });
export const emailCodeSchema = z.object({ email, code });
export const resetPasswordSchema = z.object({ email, code, password });
export const codeOnlySchema = z.object({ code });
export const pushTokenSchema = z.object({ pushToken: z.string().trim().min(10).max(300) });

export const updateMeSchema = z
  .object({ name: name.optional(), phone: phone.optional() })
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');

const currentYear = new Date().getFullYear();

export const vehicleSchema = z.object({
  type: z.enum(VEHICLE_TYPES, { error: 'Tipo de veículo inválido.' }),
  brand: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(3).max(30),
  plate: z
    .string()
    .transform((value) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    // Cobre o padrão antigo (ABC1234) e o Mercosul (ABC1D23).
    .refine((value) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value), 'Placa inválida.'),
  year: z.number().int().min(1990, 'Ano inválido.').max(currentYear + 1, 'Ano inválido.'),
});

export const documentParamSchema = z.object({ type: z.enum(DOCUMENT_TYPES, { error: 'Tipo de documento inválido.' }) });
