import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from './config.js'

export function encryptJson(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptJson(value) {
  if (!value) return null
  const [version, iv, tag, encrypted] = value.split(':')
  if (version !== 'v1') throw new Error('Unsupported encrypted value version.')
  const errors = []
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()])
      return JSON.parse(decrypted.toString('utf8'))
    } catch (error) {
      errors.push(error)
    }
  }
  throw errors.at(-1) || new Error('Unable to decrypt saved value.')
}

function encryptionKey() {
  if (config.encryptionKey) {
    const raw = Buffer.from(config.encryptionKey, 'base64')
    if (raw.length === 32) return raw
  }
  if (config.nodeEnv === 'production') throw new Error('APP_ENCRYPTION_KEY must be a 32-byte base64 key in production.')
  return legacyDevelopmentKey()
}

function decryptionKeys() {
  const current = encryptionKey()
  if (config.nodeEnv === 'production') return [current]
  const legacy = legacyDevelopmentKey()
  return current.equals(legacy) ? [current] : [current, legacy]
}

function legacyDevelopmentKey() {
  return createHash('sha256').update('development-only-encryption-key-change-before-production').digest()
}
