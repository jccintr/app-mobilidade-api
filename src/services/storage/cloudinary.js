import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env.js';

/**
 * Armazenamento no Cloudinary.
 *  - public: URL aberta (avatares)
 *  - private: type "authenticated" (documentos) -> só com link assinado e temporário
 *
 * ATENÇÃO: este arquivo não foi testado contra uma conta real de Cloudinary.
 */

let configured = false;
function configure() {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
  configured = true;
}

export async function save(buffer, { folder, ext, mimetype, privacy = 'public' }) {
  configure();
  const deliveryType = privacy === 'private' ? 'authenticated' : 'upload';
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `mobilidade/${folder}`, resource_type: 'auto', type: deliveryType, overwrite: false },
      (error, response) => (error ? reject(error) : resolve(response)),
    );
    stream.end(buffer);
  });
  return {
    provider: 'cloudinary',
    key: result.public_id,
    url: privacy === 'public' ? result.secure_url : undefined,
    resourceType: result.resource_type,
    deliveryType,
    format: result.format ?? ext,
    mimetype,
    uploadedAt: new Date(),
  };
}

export async function remove(asset) {
  configure();
  await cloudinary.uploader.destroy(asset.key, {
    resource_type: asset.resourceType || 'image',
    type: asset.deliveryType || 'upload',
    invalidate: true,
  });
}

/** Link assinado e temporário (5 minutos) para um arquivo privado. */
export function signedUrl(asset, { ttlSeconds = 300 } = {}) {
  configure();
  return cloudinary.utils.private_download_url(asset.key, asset.format || 'jpg', {
    resource_type: asset.resourceType || 'image',
    type: asset.deliveryType || 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}
