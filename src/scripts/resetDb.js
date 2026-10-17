/**
 * Apaga TODOS os dados do banco (operadoras, motoristas, passageiros, corridas, mensagens, tarifas, admins),
 * mantendo as coleções e os índices. Pensado para zerar o ambiente de testes.
 *
 *   npm run db:reset -- --yes            apaga tudo
 *   npm run db:reset -- --yes --seed     apaga tudo e recria o super admin (usa SUPER_ADMIN_EMAIL/PASSWORD do .env)
 *
 * Trava: sem --yes não faz nada. Com NODE_ENV=production exige também --production.
 * Arquivos enviados (fotos, documentos) NÃO são apagados: na pasta uploads/ (ou no Cloudinary) ficam órfãos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

const flags = new Set(process.argv.slice(2));

if (!flags.has('--yes')) {
  console.error('Isto apaga TODOS os dados do banco. Para confirmar, rode: npm run db:reset -- --yes [--seed]');
  process.exit(1);
}

const { env, assertEnv } = await import('../config/env.js');
if (env.nodeEnv === 'production' && !flags.has('--production')) {
  console.error('NODE_ENV=production: se tem certeza, acrescente também --production.');
  process.exit(1);
}

const { connectDb, disconnectDb } = await import('../config/db.js');

async function main() {
  assertEnv();
  await connectDb();
  const db = mongoose.connection.db;
  console.log(`Banco: ${mongoose.connection.name} em ${mongoose.connection.host}`);

  // garante que todos os modelos estão carregados (para recriar os índices no final)
  const modelsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
  for (const file of fs.readdirSync(modelsDir).filter((f) => f.endsWith('.js'))) {
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }

  const collections = (await db.listCollections().toArray()).filter((c) => !c.name.startsWith('system.'));
  for (const { name } of collections) {
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`  ${name}: ${deletedCount} apagados`);
  }
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  console.log('Índices conferidos.');
  await disconnectDb();

  if (flags.has('--seed')) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(process.execPath, [path.join(here, 'seed.js')], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  } else {
    console.log('\nBanco zerado. Para recriar o super admin: npm run seed');
  }
}

main().catch(async (error) => {
  console.error(error.message ?? error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
