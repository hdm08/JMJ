import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

const SESSION_COOKIE = 'jmj_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function newSession() {
  const id = randomBytes(32).toString('base64url')
  return {
    id,
    hash: hashSessionId(id),
    csrfToken: randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }
}

export function hashSessionId(sessionId) {
  return createHmac('sha256', sessionSecret()).update(sessionId).digest('base64url')
}

export function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function getSessionId(req) {
  return req.cookies?.[SESSION_COOKIE] || ''
}

export function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith('scrypt:')) return false
  const [, salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function requireAuth(store) {
  return async (req, res, next) => {
    const session = await authenticatedSession(req, store)
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

export async function authenticatedSession(req, store) {
  const sessionId = getSessionId(req)
  if (!sessionId) return null
  const session = await store.getSession(hashSessionId(sessionId))
  if (!session) return null
  if (Date.parse(session.expiresAt) < Date.now()) {
    await store.deleteSession(session.hash)
    return null
  }
  return session
}

function sessionSecret() {
  if (config.sessionSecret) return config.sessionSecret
  if (config.nodeEnv === 'production') throw new Error('SESSION_SECRET is required in production.')
  return 'development-only-session-secret-change-before-production'
}
