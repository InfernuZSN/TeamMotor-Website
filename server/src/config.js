const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env.NODE_ENV || 'development';
const config = {
  env,
  isProd: env === 'production',
  port: parseInt(process.env.PORT, 10) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/teammotor',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
  brevoApiKey: (process.env.BREVO_API_KEY || '').trim(),
  brevoSenderEmail: (process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || '').trim(),
  brevoSenderName: (process.env.BREVO_SENDER_NAME || 'TeamMotor').trim(),
  smtp: {
    host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim()
  }
};

function validateJwtSecret(secret, isProd) {
  const s = String(secret || '').trim();
  const isWeak = !s || s.length < 32 || /change-me|default|placeholder|teammotor_production_jwt_secret/i.test(s);
  if (!isWeak) return s;
  if (isProd) {
    throw new Error('[config] FATAL: JWT_SECRET must be configured with a strong secret (at least 32 characters) in production.');
  }
  return crypto.randomBytes(32).toString('hex');
}

if (!config.jwtSecret || config.jwtSecret.length < 32 || /change-me|default|placeholder|teammotor_production_jwt_secret/i.test(config.jwtSecret)) {
  config.jwtSecret = validateJwtSecret(config.jwtSecret, config.isProd);
  console.warn('[config] Development mode: JWT_SECRET missing or weak — generated ephemeral per-boot secret.');
}
config.validateJwtSecret = validateJwtSecret;

module.exports = config;
