import { config } from './config.js'
import { readCookieJson, writeCookieJson } from './cookie-state.js'

const SETTINGS_COOKIE = 'jmj_settings'
const SETTINGS_TTL_MS = 180 * 24 * 60 * 60 * 1000
const DEFAULT_SHARE_LINKS = true

export async function getWebsiteSettings(req) {
  const saved = savedSettings(req)
  return {
    businessName: clean(saved.businessName) || config.businessName,
    currency: clean(saved.currency).toUpperCase() || config.currency,
    driveRootFolderName: clean(saved.driveRootFolderName) || config.driveRootFolderName,
    shareDriveLinksPublic: typeof saved.shareDriveLinksPublic === 'boolean' ? saved.shareDriveLinksPublic : DEFAULT_SHARE_LINKS,
  }
}

export async function getGoogleOAuthConfig(req) {
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  }
}

export async function getPublicSettings(req) {
  const settings = await getWebsiteSettings(req)
  const oauth = await getGoogleOAuthConfig(req)
  return {
    ...settings,
    googleClientId: oauth.clientId,
    googleRedirectUri: oauth.redirectUri,
    googleClientSecretSet: Boolean(oauth.clientSecret),
  }
}

export async function savePublicSettings(req, res, body) {
  const current = savedSettings(req)
  const next = {
    ...current,
    businessName: clean(body.businessName) || config.businessName,
    currency: clean(body.currency).toUpperCase() || config.currency,
    driveRootFolderName: clean(body.driveRootFolderName) || config.driveRootFolderName,
    shareDriveLinksPublic: body.shareDriveLinksPublic === true || body.shareDriveLinksPublic === 'true',
  }

  req.jmjSettings = next
  writeCookieJson(res, SETTINGS_COOKIE, next, SETTINGS_TTL_MS)
  return getPublicSettings(req)
}

export async function resolvedDriveRootFolderName(req) {
  return (await getWebsiteSettings(req)).driveRootFolderName
}

export async function resolvedBusinessName(req) {
  return (await getWebsiteSettings(req)).businessName
}

export async function resolvedShareDriveLinksPublic(req) {
  return (await getWebsiteSettings(req)).shareDriveLinksPublic
}

function savedSettings(req) {
  return req.jmjSettings || readCookieJson(req, SETTINGS_COOKIE) || {}
}

function clean(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}
