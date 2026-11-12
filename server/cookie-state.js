import { config } from './config.js'
import { decryptJson, encryptJson } from './crypto-box.js'

export function readCookieJson(req, name) {
  const encrypted = req.cookies?.[name]
  if (!encrypted) return null
  try {
    return decryptJson(encrypted)
  } catch {
    return null
  }
}

export function writeCookieJson(res, name, value, maxAgeMs) {
  const encrypted = encryptJson(value)
  res.cookie(name, encrypted, cookieOptions(maxAgeMs))
  return encrypted
}

export function clearStateCookie(res, name) {
  res.clearCookie(name, { path: '/' })
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  }
}
