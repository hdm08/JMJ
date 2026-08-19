import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const password = process.argv[2]

if (!password || password.length < 12) {
  console.error('Usage: npm run website:hash-admin -- "a password with at least 12 characters"')
  process.exit(1)
}

const salt = randomBytes(16).toString('base64url')
const hash = scryptSync(password, salt, 64).toString('base64url')
const result = `scrypt:${salt}:${hash}`

const expected = Buffer.from(hash, 'base64url')
const actual = scryptSync(password, salt, 64)
if (!timingSafeEqual(expected, actual)) {
  console.error('Password hash verification failed.')
  process.exit(1)
}

console.log(result)
