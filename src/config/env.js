import 'dotenv/config';

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
const bool = (value, fallback = false) =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
const list = (value) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const port = num(process.env.PORT, 3333);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  // Nome da plataforma: fica só aqui (e no painel do super-admin / e-mails). Trocar é uma linha.
  platformName: process.env.PLATFORM_NAME ?? 'Plataforma de Mobilidade',
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/mobilidade',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  corsOrigins: list(process.env.CORS_ORIGINS),
  code: {
    ttlMinutes: num(process.env.CODE_TTL_MINUTES, 15),
    maxAttempts: num(process.env.CODE_MAX_ATTEMPTS, 5),
    resendSeconds: num(process.env.CODE_RESEND_SECONDS, 60),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: num(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local', // 'local' | 'cloudinary'
    uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
    maxImageMb: num(process.env.MAX_IMAGE_MB, 5),
    maxDocMb: num(process.env.MAX_DOC_MB, 8),
  },
  rides: {
    routingProvider: process.env.ROUTING_PROVIDER ?? 'fake', // 'fake' | 'google'
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
    maxRideKm: num(process.env.MAX_RIDE_KM, 80),
    dispatchRadiusMeters: num(process.env.DISPATCH_RADIUS_METERS, 5000),
    searchSeconds: num(process.env.DISPATCH_SEARCH_SECONDS, 60),
    offerSeconds: num(process.env.OFFER_SECONDS, 20),
    maxOffers: num(process.env.MAX_OFFERS, 5),
    locationMaxAgeSeconds: num(process.env.LOCATION_MAX_AGE_SECONDS, 120),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
};

/** Chamado na subida do servidor: falha cedo se faltar algo essencial. */
export function assertEnv() {
  const problems = [];
  if (env.jwtSecret.length < 32) problems.push('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  if (env.storage.driver === 'cloudinary') {
    const { cloudName, apiKey, apiSecret } = env.cloudinary;
    if (!cloudName || !apiKey || !apiSecret) {
      problems.push('STORAGE_DRIVER=cloudinary exige CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.');
    }
  }
  if (!['fake', 'google'].includes(env.rides.routingProvider)) {
    problems.push('ROUTING_PROVIDER deve ser "fake" ou "google".');
  }
  if (env.rides.routingProvider === 'google' && !env.rides.googleMapsApiKey) {
    problems.push('ROUTING_PROVIDER=google exige GOOGLE_MAPS_API_KEY.');
  }
  if (!['local', 'cloudinary'].includes(env.storage.driver)) {
    problems.push('STORAGE_DRIVER deve ser "local" ou "cloudinary".');
  }
  if (problems.length) {
    throw new Error(`Configuração inválida:\n- ${problems.join('\n- ')}`);
  }
}
