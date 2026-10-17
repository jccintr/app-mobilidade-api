import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Armazenamento em disco (desenvolvimento ou servidor com volume).
 *  - uploads/public/...  -> servido em /uploads/public (avatares)
 *  - uploads/private/... -> NUNCA servido direto; só via rota protegida do admin (documentos)
 */

export const uploadRoot = () => path.resolve(env.storage.uploadDir);

export async function save(buffer, { folder, ext, mimetype, privacy = 'public' }) {
  const relative = path.posix.join(privacy, folder, `${crypto.randomUUID()}.${ext}`);
  const absolute = path.join(uploadRoot(), ...relative.split('/'));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, buffer);
  return {
    provider: 'local',
    key: relative,
    url: privacy === 'public' ? `${env.publicUrl}/uploads/${relative}` : undefined,
    format: ext,
    mimetype,
    uploadedAt: new Date(),
  };
}

function resolveSafe(key) {
  const root = uploadRoot();
  const absolute = path.resolve(root, ...String(key).split('/'));
  if (!absolute.startsWith(root + path.sep)) throw new Error('Caminho inválido.');
  return absolute;
}

export async function remove(asset) {
  try {
    await fs.unlink(resolveSafe(asset.key));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Entrega um arquivo privado na resposta HTTP. */
export function sendPrivate(asset, res) {
  return new Promise((resolve, reject) => {
    res.type(asset.mimetype || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(resolveSafe(asset.key), (error) => (error ? reject(error) : resolve()));
  });
}
