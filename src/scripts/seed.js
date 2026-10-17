/**
 * Cria o super administrador (e, com --demo, uma operadora de demonstração).
 *
 *   SUPER_ADMIN_EMAIL=voce@exemplo.com SUPER_ADMIN_PASSWORD='uma-senha-forte' npm run seed
 *   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... npm run seed -- --demo
 *
 * É seguro rodar de novo: não duplica nada.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { assertEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { AdminUser } from '../models/AdminUser.js';
import { PricingRule } from '../models/PricingRule.js';
import { Tenant } from '../models/Tenant.js';
import { exampleRule } from '../pricing/exampleRule.js';
import { pricingConfigSchema } from '../pricing/schema.js';

async function main() {
  assertEnv();
  const email = (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? '';
  if (!email || password.length < 12) {
    throw new Error('Defina SUPER_ADMIN_EMAIL e SUPER_ADMIN_PASSWORD (mínimo 12 caracteres).');
  }

  await connectDb();

  if (await AdminUser.exists({ tenantId: null, email })) {
    console.log(`Super admin já existe: ${email}`);
  } else {
    await AdminUser.create({
      tenantId: null,
      role: 'super_admin',
      name: 'Super Admin',
      email,
      passwordHash: await bcrypt.hash(password, 10),
    });
    console.log(`Super admin criado: ${email}`);
  }

  if (process.argv.includes('--demo')) {
    let tenant = await Tenant.findOne({ slug: 'demo' });
    if (!tenant) {
      tenant = await Tenant.create({
        name: 'Operadora Demo',
        slug: 'demo',
        cities: [{ name: 'Cidade Exemplo', uf: 'MG' }],
      });
      console.log('Operadora "demo" criada.');
    }

    const demoEmail = 'admin@demo.local';
    if (!(await AdminUser.exists({ tenantId: tenant._id, email: demoEmail }))) {
      const demoPassword = crypto.randomBytes(9).toString('base64url');
      await AdminUser.create({
        tenantId: tenant._id,
        role: 'operator_admin',
        name: 'Admin Demo',
        email: demoEmail,
        passwordHash: await bcrypt.hash(demoPassword, 10),
      });
      console.log(`Admin da operadora demo: ${demoEmail} / ${demoPassword}  (anote: não será mostrada de novo)`);
    }

    if (!(await PricingRule.exists({ tenantId: tenant._id }))) {
      await PricingRule.create({
        tenantId: tenant._id,
        name: 'Regra de exemplo',
        notes: 'Valores ilustrativos: ajuste no painel.',
        version: 1,
        active: true,
        config: pricingConfigSchema.parse(exampleRule),
      });
      console.log('Regra de tarifa de exemplo criada e ativada.');
    }
  }

  await disconnectDb();
}

main().catch(async (error) => {
  console.error(error.message ?? error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
