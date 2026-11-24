import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: int(process.env.PORT, 4000),
  mongoUri: (process.env.MONGODB_URI || '').trim(),
  jwtSecret: (process.env.JWT_SECRET || '').trim(),
  adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  eventName: process.env.EVENT_NAME || 'Namma Honda Habba',
  corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: (process.env.TRUST_PROXY || '').trim(),
  seedDemo: int(process.env.SEED_DEMO, 0),
  publicAppUrl: (process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, ''),
  whatsapp: {
    token: (process.env.WHATSAPP_TOKEN || '').trim(),
    phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    template: (process.env.WHATSAPP_TEMPLATE || '').trim(),
    templateLang: (process.env.WHATSAPP_TEMPLATE_LANG || 'en').trim(),
    apiVersion: (process.env.WHATSAPP_API_VERSION || 'v23.0').trim(),
    countryCode: (process.env.WHATSAPP_COUNTRY_CODE || '91').replace(/\D/g, ''),
  },
  // Deployed functions (Netlify runs on AWS Lambda) are always production, even if NODE_ENV was not set.
  isProduction: process.env.NODE_ENV === 'production' || !!process.env.AWS_LAMBDA_FUNCTION_NAME,
};
