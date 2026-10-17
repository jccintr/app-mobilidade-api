import { env } from '../../config/env.js';
import * as local from './local.js';
import * as cloud from './cloudinary.js';

const driver = () => (env.storage.driver === 'cloudinary' ? cloud : local);

/** Fachada única: o resto do código não sabe se o arquivo está em disco ou no Cloudinary. */
export const storage = {
  save: (buffer, options) => driver().save(buffer, options),

  remove: (asset) => {
    if (!asset?.key) return Promise.resolve();
    return (asset.provider === 'cloudinary' ? cloud : local).remove(asset);
  },

  signedUrl: (asset) => cloud.signedUrl(asset),

  /** Entrega um arquivo privado: link assinado (Cloudinary) ou o próprio arquivo (disco). */
  async sendPrivate(asset, res) {
    if (asset.provider === 'cloudinary') {
      return res.redirect(302, cloud.signedUrl(asset));
    }
    return local.sendPrivate(asset, res);
  },
};
