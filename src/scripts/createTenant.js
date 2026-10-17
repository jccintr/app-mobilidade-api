/**
 * Cria uma operadora nova com tudo o que ela precisa para começar: o cadastro, um administrador
 * e a regra de tarifa de exemplo (ativa, para ajustar depois no painel).
 *
 *   npm run tenant:create -- --slug velo --name "Velo" --city "Pouso Alegre" --uf MG --admin-email dono@velo.com
 *
 * Opcionais: --lat -22.23 --lng -45.94 (onde o mapa abre) · --admin-name "Fulano"
 * É seguro rodar de novo: não duplica nada. A senha do administrador é mostrada uma única vez.
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

function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) out[list[i].slice(2)] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : 'true';
  }
  return out;
}

async function main() {
  const a = args();
  const slug = (a.slug ?? '').toLowerCase();
  const name = a.name;
  const city = a.city;
  const uf = (a.uf ?? '').toUpperCase();
  const adminEmail = (a['admin-email'] ?? '').toLowerCase();
  if (!slug || !name || !city || uf.length !== 2 || !adminEmail.includes('@')) {
    throw new Error('Uso: npm run tenant:create -- --slug velo --name "Velo" --city "Pouso Alegre" --uf MG --admin-email dono@velo.com');
  }
  assertEnv();
  await connectDb();

  let tenant = await Tenant.findOne({ slug });
  if (tenant) {
    console.log(`Operadora "${slug}" já existe.`);
  } else {
    const lat = Number(a.lat);
    const lng = Number(a.lng);
    tenant = await Tenant.create({
      name,
      slug,
      brand: { displayName: name },
      cities: [{ name: city, uf }],
      ...(Number.isFinite(lat) && Number.isFinite(lng) && a.lat && a.lng ? { map: { center: { lat, lng }, zoom: 13 } } : {}),
    });
    console.log(`Operadora "${name}" criada (slug: ${slug}).`);
  }

  if (await AdminUser.exists({ tenantId: tenant._id, email: adminEmail })) {
    console.log(`Administrador já existe: ${adminEmail}`);
  } else {
    const password = crypto.randomBytes(9).toString('base64url');
    await AdminUser.create({
      tenantId: tenant._id,
      role: 'operator_admin',
      name: a['admin-name'] ?? `Admin ${name}`,
      email: adminEmail,
      passwordHash: await bcrypt.hash(password, 10),
    });
    console.log(`Administrador criado: ${adminEmail} / ${password}   (anote: a senha não será mostrada de novo)`);
  }

  if (!(await PricingRule.exists({ tenantId: tenant._id }))) {
    await PricingRule.create({
      tenantId: tenant._id,
      name: 'Regra de exemplo',
      notes: 'Valores ilustrativos: ajuste no painel antes de operar.',
      version: 1,
      active: true,
      config: pricingConfigSchema.parse(exampleRule),
    });
    console.log('Regra de tarifa de exemplo criada e ativada. Ajuste no painel (Tarifas).');
  }

  console.log(`\nNos apps desta operadora: EXPO_PUBLIC_TENANT=${slug}`);
  await disconnectDb();
}

main().catch(async (error) => {
  console.error(error.message ?? error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
