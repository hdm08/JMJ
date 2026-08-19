import { config } from './config.js'

const FIREBASE_SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'
const FIREBASE_UPDATE_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:update'

export function firebaseAuthConfigured() {
  return Boolean(config.firebaseApiKey)
}

export async function verifyFirebasePassword(email, password) {
  if (!firebaseAuthConfigured()) throw new Error('Firebase Authentication is not configured.')
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail || !password) return null
  if (config.firebaseAllowedEmails.length && !config.firebaseAllowedEmails.includes(normalizedEmail)) return null

  const response = await fetch(`${FIREBASE_SIGN_IN_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      returnSecureToken: true,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) return null
  if (!body.localId || !body.email) return null

  return {
    uid: String(body.localId),
    email: String(body.email).toLowerCase(),
    idToken: String(body.idToken || ''),
    refreshToken: String(body.refreshToken || ''),
    expiresIn: String(body.expiresIn || ''),
  }
}

export async function changeFirebasePassword(idToken, newPassword) {
  if (!firebaseAuthConfigured()) throw new Error('Firebase Authentication is not configured.')
  if (!idToken) throw new Error('Sign in again before changing your password.')

  const response = await fetch(`${FIREBASE_UPDATE_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      password: newPassword,
      returnSecureToken: true,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(firebaseErrorMessage(body.error?.message))
  if (!body.localId) throw new Error('Firebase did not confirm the password change.')
  return {
    uid: String(body.localId),
    email: String(body.email || '').toLowerCase(),
  }
}

function firebaseErrorMessage(code = '') {
  if (code === 'WEAK_PASSWORD : Password should be at least 6 characters') return 'Choose a stronger password with at least 6 characters.'
  if (code === 'INVALID_ID_TOKEN' || code === 'TOKEN_EXPIRED') return 'Sign in again before changing your password.'
  return 'Could not change password in Firebase. Check the password and try again.'
}
