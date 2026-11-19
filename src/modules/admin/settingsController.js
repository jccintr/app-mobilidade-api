import { Tenant } from '../../models/Tenant.js';
import { invalidateTenantCache } from '../../middlewares/tenant.js';
import { storage } from '../../services/storage/index.js';
import { AppError, badRequest } from '../../utils/errors.js';
import { EXT_BY_TYPE, MIME_BY_TYPE, sniffFileType } from '../../utils/fileType.js';
import { normalizePixKey } from '../../utils/pix.js';
import { billingConfig, isBillingEnabled } from '../../billing/fee.js';
import { tenantPix } from '../credits/purchases.js';

/** O que a operadora pode ver/alterar sozinha (o resto é do dono da plataforma). */
function billingView(tenant) {
  const config = billingConfig(tenant);
  const pix = tenant.billing?.pix ?? {};
  return {
    ...config,
    enabled: isBillingEnabled(config),
    pix: { key: pix.key ?? '', keyType: pix.keyType ?? null, receiverName: pix.receiverName ?? '', city: pix.city ?? '' },
    pixReady: Boolean(tenantPix(tenant)),
    notifyEmail: tenant.billing?.notifyEmail ?? '',
  };
}

/** Converte o bloco "billing" do formulário em campos do $set/$unset (a chave Pix é validada e normalizada). */
function billingChanges(billing, set, unset) {
  for (const field of ['feeFixedCents', 'feePercent', 'lowBalanceCents', 'welcomeCreditCents']) {
    if (billing[field] !== undefined) set[`billing.${field}`] = billing[field];
  }
  if (billing.notifyEmail !== undefined) {
    if (billing.notifyEmail) set['billing.notifyEmail'] = billing.notifyEmail;
    else unset['billing.notifyEmail'] = '';
  }
  const pix = billing.pix;
  if (!pix) return;
  if (pix.receiverName !== undefined) set['billing.pix.receiverName'] = pix.receiverName;
  if (pix.city !== undefined) set['billing.pix.city'] = pix.city;
  if (pix.key !== undefined) {
    if (!pix.key) {
      unset['billing.pix.key'] = '';
      unset['billing.pix.keyType'] = '';
      return;
    }
    const normalized = normalizePixKey(pix.key, pix.keyType ?? null);
    if (!normalized.ok) {
      throw badRequest(normalized.code, normalized.message, normalized.candidates ? { candidates: normalized.candidates } : undefined);
    }
    set['billing.pix.key'] = normalized.key;
    set['billing.pix.keyType'] = normalized.type;
  }
}

function view(tenant) {
  const { name, slug, brand = {}, cities = [], map } = tenant;
  return {
    billing: billingView(tenant),
    name,
    slug,
    brand: { displayName: brand.displayName || name, primaryColor: brand.primaryColor || '#111827', logoUrl: brand.logoUrl || null },
    cities,
    map: map?.center?.lat !== undefined ? { center: map.center, zoom: map.zoom ?? 13 } : null,
  };
}

async function reload(req) {
  invalidateTenantCache(req.tenant.slug);
  return Tenant.findById(req.tenant._id).lean();
}

export const settingsController = {
  async get(req, res) {
    res.json({ settings: view(req.tenant) });
  },

  async update(req, res) {
    const { brand, map, cities, billing } = req.valid;
    const set = {};
    const unset = {};
    if (billing) billingChanges(billing, set, unset);
    if (brand?.displayName) set['brand.displayName'] = brand.displayName;
    if (brand?.primaryColor) set['brand.primaryColor'] = brand.primaryColor;
    if (map) set.map = map;
    if (cities) set.cities = cities;
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) await Tenant.updateOne({ _id: req.tenant._id }, update, { runValidators: true });
    res.json({ settings: view(await reload(req)) });
  },

  async uploadLogo(req, res) {
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Envie a imagem no campo "logo".');
    const kind = sniffFileType(req.file.buffer);
    if (!['jpeg', 'png', 'webp'].includes(kind)) {
      throw new AppError(415, 'INVALID_FILE_TYPE', 'Envie uma imagem JPG, PNG ou WEBP.');
    }
    const asset = await storage.save(req.file.buffer, {
      folder: `${req.tenant.slug}/brand`,
      ext: EXT_BY_TYPE[kind],
      mimetype: MIME_BY_TYPE[kind],
      privacy: 'public',
    });
    const previous = req.tenant.brand?.logoAsset;
    await Tenant.updateOne({ _id: req.tenant._id }, { $set: { 'brand.logoUrl': asset.url, 'brand.logoAsset': { provider: asset.provider, key: asset.key } } });
    if (previous?.key) storage.remove(previous).catch(() => {});
    res.json({ settings: view(await reload(req)) });
  },

  async removeLogo(req, res) {
    const previous = req.tenant.brand?.logoAsset;
    await Tenant.updateOne({ _id: req.tenant._id }, { $unset: { 'brand.logoUrl': '', 'brand.logoAsset': '' } });
    if (previous?.key) storage.remove(previous).catch(() => {});
    res.json({ settings: view(await reload(req)) });
  },
};
