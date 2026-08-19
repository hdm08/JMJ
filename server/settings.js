import { config } from './config.js'
import { decryptJson, encryptJson } from './crypto-box.js'

const DEFAULT_SHARE_LINKS = true

export async function getWebsiteSettings(store) {
  const saved = await store.getWebsiteSettings()
  return {
    businessName: clean(saved.businessName) || config.businessName,
    currency: clean(saved.currency).toUpperCase() || config.currency,
    driveRootFolderName: clean(saved.driveRootFolderName) || config.driveRootFolderName,
    shareDriveLinksPublic: typeof saved.shareDriveLinksPublic === 'boolean' ? saved.shareDriveLinksPublic : DEFAULT_SHARE_LINKS,
  }
}

export async function getGoogleOAuthConfig(store) {
  const saved = decryptJson(await store.getGoogleOAuthConfig()) || {}
  return {
    clientId: clean(saved.clientId) || config.googleClientId,
    clientSecret: clean(saved.clientSecret, 1000) || config.googleClientSecret,
    redirectUri: clean(saved.redirectUri, 500) || config.googleRedirectUri,
  }
}

export async function getPublicSettings(store) {
  const settings = await getWebsiteSettings(store)
  const oauth = await getGoogleOAuthConfig(store)
  return {
    ...settings,
    googleClientId: oauth.clientId,
    googleRedirectUri: oauth.redirectUri,
    googleClientSecretSet: Boolean(oauth.clientSecret),
  }
}

export async function savePublicSettings(store, body) {
  const settings = await store.saveWebsiteSettings({
    businessName: clean(body.businessName) || config.businessName,
    currency: clean(body.currency).toUpperCase() || config.currency,
    driveRootFolderName: clean(body.driveRootFolderName) || config.driveRootFolderName,
    shareDriveLinksPublic: body.shareDriveLinksPublic === true || body.shareDriveLinksPublic === 'true',
  })

  if (Object.hasOwn(body, 'googleClientId') || Object.hasOwn(body, 'googleClientSecret') || Object.hasOwn(body, 'googleRedirectUri')) {
    const current = await getGoogleOAuthConfig(store)
    const next = {
      clientId: clean(body.googleClientId) || current.clientId,
      clientSecret: clean(body.googleClientSecret, 1000) || current.clientSecret,
      redirectUri: clean(body.googleRedirectUri, 500) || current.redirectUri,
    }
    await store.setGoogleOAuthConfig(encryptJson(next))
  }

  return {
    ...settings,
    ...(await getPublicSettings(store)),
  }
}

export async function resolvedDriveRootFolderName(store) {
  return (await getWebsiteSettings(store)).driveRootFolderName
}

export async function resolvedBusinessName(store) {
  return (await getWebsiteSettings(store)).businessName
}

export async function resolvedShareDriveLinksPublic(store) {
  return (await getWebsiteSettings(store)).shareDriveLinksPublic
}

function clean(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}
