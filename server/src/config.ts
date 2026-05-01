import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  coolifyUrl:           (process.env.COOLIFY_URL ?? '').replace(/\/$/, ''),
  coolifyToken:         process.env.COOLIFY_TOKEN ?? '',
  coolifyApiVersion:    (process.env.COOLIFY_API_VERSION ?? 'v1').replace(/^\/|\/$/g, ''),
  port:                 parseInt(process.env.PORT ?? '3001', 10),
  // Firebase Admin SDK (server-side)
  firebaseProjectId:    process.env.FIREBASE_PROJECT_ID ?? '',
  firebaseClientEmail:  process.env.FIREBASE_CLIENT_EMAIL ?? '',
  firebasePrivateKey:   (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  superAdminEmail:      process.env.SUPER_ADMIN_EMAIL ?? '',
  // Empty string = allow any domain. Set to e.g. "acme.com" to restrict logins.
  allowedEmailDomain:   (process.env.ALLOWED_EMAIL_DOMAIN ?? '').trim().replace(/^@/, ''),
  // Firebase Web SDK (served to client at runtime via /api/config)
  firebaseApiKey:            process.env.FIREBASE_API_KEY ?? '',
  firebaseAuthDomain:        process.env.FIREBASE_AUTH_DOMAIN ?? '',
  firebaseStorageBucket:     process.env.FIREBASE_STORAGE_BUCKET ?? '',
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
  firebaseAppId:             process.env.FIREBASE_APP_ID ?? '',
  googleHd:                  process.env.GOOGLE_HD ?? '',
};

const missing: string[] = [];
if (!config.coolifyUrl)          missing.push('COOLIFY_URL');
if (!config.coolifyToken)        missing.push('COOLIFY_TOKEN');
if (!config.firebaseProjectId)   missing.push('FIREBASE_PROJECT_ID');
if (!config.firebaseClientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
if (!config.firebasePrivateKey)  missing.push('FIREBASE_PRIVATE_KEY');

if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '));
  process.exit(1);
}

if (!config.allowedEmailDomain) {
  console.warn('WARNING: ALLOWED_EMAIL_DOMAIN is not set — any Google account can sign in');
}
