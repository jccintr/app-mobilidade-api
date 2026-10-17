import multer from 'multer';
import { env } from '../config/env.js';

// Arquivos ficam em memória só até serem enviados ao armazenamento.
// O tipo real é conferido depois pelos bytes do arquivo (utils/fileType.js).
const single = (field, maxMb) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 5, parts: 8 },
  }).single(field);

export const avatarUpload = single('avatar', env.storage.maxImageMb);
export const documentUpload = single('file', env.storage.maxDocMb);
export const logoUpload = single('logo', env.storage.maxImageMb);
