const path = require('path');
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

if (!config.jwtSecret || config.jwtSecret.length < 24 || /change-me/i.test(config.jwtSecret)) {
  if (config.isProd) {
    throw new Error('JWT_SECRET must be set to a long random value in production.');
  }
  // Development convenience only: random per-process secret (logins reset on every restart).
  config.jwtSecret = require('crypto').randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET missing/weak — using a temporary random secret (dev only).');
}

module.exports = config;
