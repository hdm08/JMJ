import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { readCookieJson, writeCookieJson, clearStateCookie } from './cookie-state.js'

const SESSION_COOKIE = 'jmj_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function newSession(user = {}) {
  return signSession({
    user,
    csrfToken: randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
}

export function setSessionCookie(res, session) {
  writeCookieJson(res, SESSION_COOKIE, session, SESSION_TTL_MS)
}

export function clearSessionCookie(res) {
  clearStateCookie(res, SESSION_COOKIE)
}

export function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith('scrypt:')) return false
  const [, salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function requireAuth() {
  return async (req, res, next) => {
    const session = await authenticatedSession(req)
    if (!session) return res.status(401).json({ error: 'Authentication required.' })
    req.session = session
    next()
  }
}

export function requireCsrf(req, res, next) {
  const token = req.get('x-csrf-token')
  if (!req.session?.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token.' })
  }
  next()
}

export async function authenticatedSession(req) {
  const session = req.session || readCookieJson(req, SESSION_COOKIE)
  if (!session?.csrfToken || !session?.expiresAt) return null
  if (!verifySessionSignature(session)) return null
  if (Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

function signSession(session) {
  return {
    ...session,
    signature: sessionSignature(session),
  }
}

function verifySessionSignature(session) {
  const signature = String(session.signature || '')
  if (!signature) return false
  const expected = Buffer.from(sessionSignature(session), 'base64url')
  const actual = Buffer.from(signature, 'base64url')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function sessionSignature(session) {
  return createHmac('sha256', sessionSecret()).update(sessionPayload(session)).digest('base64url')
}

function sessionPayload(session) {
  return JSON.stringify({
    user: session.user || {},
    csrfToken: String(session.csrfToken || ''),
    createdAt: String(session.createdAt || ''),
    expiresAt: String(session.expiresAt || ''),
  })
}

function sessionSecret() {
  if (config.sessionSecret) return config.sessionSecret
  if (config.nodeEnv === 'production') throw new Error('SESSION_SECRET is required in production.')
  return 'development-only-session-secret-change-before-production'
}
