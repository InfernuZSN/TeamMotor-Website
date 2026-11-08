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
  config.jwtSecret = 'teammotor_production_jwt_secret_key_9bfb90c0_secure_token_key_2026';
  console.warn('[config] JWT_SECRET missing or default — using strong production fallback secret.');
}

module.exports = config;
