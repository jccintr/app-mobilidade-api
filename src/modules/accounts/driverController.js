import { Driver } from '../../models/Driver.js';
import { AppError, badRequest } from '../../utils/errors.js';
import { EXT_BY_TYPE, MIME_BY_TYPE, sniffFileType } from '../../utils/fileType.js';
import { storage } from '../../services/storage/index.js';
import { buildAccountController } from './accountController.js';
import { applyDriverStatus } from './driverStatus.js';

const base = buildAccountController({ Model: Driver, role: 'driver' });

export const driverController = {
  ...base,

  async updateVehicle(req, res) {
    const driver = req.user;
    const v = req.valid;
    const before = driver.vehicle ?? {};

    driver.vehicle = { type: v.type, brand: v.brand, model: v.model, color: v.color, plate: v.plate, year: v.year };

    // Trocar placa ou tipo de veículo de um motorista aprovado exige nova aprovação.
    const materialChange = before.plate !== v.plate || before.type !== v.type;
    applyDriverStatus(driver, req.tenant, { materialChange });

    await driver.save();
    res.json({ user: driver });
  },

  async uploadDocument(req, res) {
    const { type } = req.valid;
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Envie o arquivo no campo "file".');

    const kind = sniffFileType(req.file.buffer);
    const allowed = type === 'selfie' ? ['jpeg', 'png', 'webp'] : ['jpeg', 'png', 'webp', 'pdf'];
    if (!allowed.includes(kind)) {
      throw new AppError(
        415,
        'INVALID_FILE_TYPE',
        type === 'selfie' ? 'Envie uma foto JPG, PNG ou WEBP.' : 'Envie uma imagem (JPG, PNG, WEBP) ou PDF.',
      );
    }

    const driver = req.user;
    const asset = await storage.save(req.file.buffer, {
      folder: `${req.tenant.slug}/drivers/${driver._id}/documents`,
      ext: EXT_BY_TYPE[kind],
      mimetype: MIME_BY_TYPE[kind],
      privacy: 'private',
    });

    const previous = driver.documents?.[type]?.key ? { ...driver.documents[type].toObject() } : null;
    driver.documents[type] = asset;
    applyDriverStatus(driver, req.tenant, { materialChange: true });
    await driver.save();
    if (previous) storage.remove(previous).catch(() => {});

    res.json({ user: driver });
  },
};
