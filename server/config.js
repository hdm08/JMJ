import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

loadEnvFile(path.join(rootDir, '.env'))

export const config = {
  rootDir,
  dataDir: process.env.DATA_DIR || path.join(rootDir, '.data', 'website'),
  storeDriver: process.env.STORE_DRIVER || 'json',
  firestoreProjectId: process.env.FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
  firestoreCollection: process.env.FIRESTORE_COLLECTION || 'jmj_os',
  firestoreDocument: process.env.FIRESTORE_DOCUMENT || 'state',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:8787',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  firebaseApiKey: process.env.FIREBASE_API_KEY || '',
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  firebaseAppId: process.env.FIREBASE_APP_ID || '',
  firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
  firebaseAllowedEmails: listFromEnv(process.env.FIREBASE_ALLOWED_EMAILS),
  sessionSecret: process.env.SESSION_SECRET || '',
  encryptionKey: process.env.APP_ENCRYPTION_KEY || '',
  businessName: process.env.BUSINESS_NAME || 'Jay Mataji Jewels',
  currency: process.env.CURRENCY || 'INR',
  driveRootFolderName: process.env.DRIVE_ROOT_FOLDER_NAME || 'JMJ Digital Catalogue',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL || 'http://localhost:8787'}/api/google/callback`,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 250) * 1024 * 1024,
}

export function assertProductionConfig() {
  if (config.nodeEnv !== 'production') return
  const missing = []
  if (!config.sessionSecret || config.sessionSecret.length < 32) missing.push('SESSION_SECRET')
  if (!config.encryptionKey) missing.push('APP_ENCRYPTION_KEY')
  if (!config.firebaseApiKey && !config.adminPasswordHash) missing.push('FIREBASE_API_KEY or ADMIN_PASSWORD_HASH')
  if (!config.publicBaseUrl.startsWith('https://')) missing.push('PUBLIC_BASE_URL=https://...')
  if (missing.length) throw new Error(`Missing production security settings: ${missing.join(', ')}`)
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equals = trimmed.indexOf('=')
    if (equals === -1) continue
    const key = trimmed.slice(0, equals).trim()
    const value = trimmed.slice(equals + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

function listFromEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}
