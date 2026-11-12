import { randomBytes } from 'node:crypto'
import { jsPDF } from 'jspdf'
import { clearStateCookie, readCookieJson, writeCookieJson } from './cookie-state.js'
import { getGoogleOAuthConfig, resolvedBusinessName, resolvedDriveRootFolderName, resolvedShareDriveLinksPublic } from './settings.js'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const TOKEN_COOKIE = 'jmj_google_tokens'
const OAUTH_STATE_COOKIE = 'jmj_google_oauth_state'
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const CATALOGUE_INDEX_NAME = 'catalogue_index.json'
const PRICE_SHEET_NAME = 'price_sheet.csv'

export async function driveConfigured(req) {
  const oauth = await getGoogleOAuthConfig(req)
  return Boolean(oauth.clientId && oauth.clientSecret && oauth.redirectUri)
}

export async function createGoogleAuthUrl(req, res, session) {
  const oauth = await getGoogleOAuthConfig(req)
  if (!oauth.clientId || !oauth.clientSecret || !oauth.redirectUri) throw new Error('Google OAuth server credentials are not configured.')

  const stateValue = randomBytes(32).toString('base64url')
  writeCookieJson(
    res,
    OAUTH_STATE_COOKIE,
    {
      value: stateValue,
      userKey: sessionUserKey(session),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    },
    OAUTH_STATE_TTL_MS,
  )

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: DRIVE_SCOPE,
    state: stateValue,
  }).toString()
  return url.toString()
}

export async function handleGoogleCallback(req, res, { code, state }, session) {
  const oauth = await getGoogleOAuthConfig(req)
  if (!code || !state) throw new Error('Google callback is missing code/state.')

  const savedState = readCookieJson(req, OAUTH_STATE_COOKIE)
  clearStateCookie(res, OAUTH_STATE_COOKIE)
  if (!savedState || savedState.value !== state || Date.parse(savedState.expiresAt) < Date.now()) {
    throw new Error('Google OAuth state check failed.')
  }
  if (savedState.userKey && savedState.userKey !== sessionUserKey(session)) {
    throw new Error('Google OAuth session check failed.')
  }

  const token = await tokenRequest({
    code,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    redirect_uri: oauth.redirectUri,
    grant_type: 'authorization_code',
  })

  writeDriveTokens(req, res, {
    ...token,
    expires_at: Date.now() + Math.max(1, (token.expires_in || 3600) - 300) * 1000,
  })
}

export async function googleDriveStatus(req) {
  const token = readDriveTokens(req)
  const oauth = await getGoogleOAuthConfig(req)
  return {
    configured: Boolean(oauth.clientId && oauth.clientSecret && oauth.redirectUri),
    connected: Boolean(token?.refresh_token || token?.access_token),
    rootFolderName: await resolvedDriveRootFolderName(req),
  }
}

export async function readCatalogueProducts(req, res) {
  const client = await driveClient(req, res)
  const root = await client.ensureFolder(await resolvedDriveRootFolderName(req))
  const indexFile = await client.findFileByName(CATALOGUE_INDEX_NAME, root.id)
  if (!indexFile) return []

  const file = await client.downloadFile(indexFile.id)
  const raw = file.buffer.toString('utf8').trim()
  if (!raw) return []

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Google Drive catalogue_index.json is not valid JSON.')
  }

  const products = Array.isArray(parsed.products) ? parsed.products : []
  return sortProducts(products)
}

export async function downloadDriveFile(req, res, fileId) {
  const client = await driveClient(req, res)
  return client.downloadFile(fileId)
}

export async function uploadProductToDrive(req, res, product, files) {
  const client = await driveClient(req, res)
  const rootFolderName = await resolvedDriveRootFolderName(req)
  const shareDriveLinksPublic = await resolvedShareDriveLinksPublic(req)
  const root = await client.ensureFolder(rootFolderName)
  const category = await client.ensureFolder(safeDriveName(product.category || 'Astrological'), root.id)
  const gem = await client.ensureFolder(safeDriveName(product.gemstone || 'Unsorted Gemstones'), category.id)
  const origin = await client.ensureFolder(safeDriveName(product.origin || 'Unsorted Origin'), gem.id)
  const weightRange = await client.ensureFolder(safeDriveName(weightRangeLabel(product.weightCt)), origin.id)
  const sku = await client.ensureFolder(safeDriveName(product.sku || product.id), weightRange.id)
  const photos = await client.ensureFolder('Photos', sku.id)
  const videos = await client.ensureFolder('Videos', sku.id)
  const certificates = files.some((file) => file.kind === 'certificate') ? await client.ensureFolder('Certificate', sku.id) : null
  const information = await client.ensureFolder('Information Card', sku.id)

  const uploadedMedia = []
  for (const file of files) {
    const parentId = file.kind === 'photo' ? photos.id : file.kind === 'video' ? videos.id : certificates?.id
    if (!parentId) continue
    const uploaded = await client.uploadBuffer({
      name: file.safeName,
      buffer: file.buffer,
      mimeType: file.mimeType,
      parentId,
    })
    if (shareDriveLinksPublic) await client.makeShareable(uploaded.id)
    uploadedMedia.push({
      id: file.id,
      kind: file.kind,
      role: file.role,
      name: file.safeName,
      mimeType: file.mimeType,
      size: file.size,
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      driveWebContentLink: uploaded.webContentLink,
      thumbnailLink: uploaded.thumbnailLink,
    })
  }

  const masterCardName = `${product.sku}_Master_Card.pdf`
  const masterCard = await client.uploadBuffer({
    name: masterCardName,
    buffer: await createMasterCardPdfBuffer(req, product, files),
    mimeType: 'application/pdf',
    parentId: information.id,
  })
  if (shareDriveLinksPublic) await client.makeShareable(masterCard.id)

  return {
    driveFolders: {
      rootFolderId: root.id,
      categoryFolderId: category.id,
      gemFolderId: gem.id,
      originFolderId: origin.id,
      weightRangeFolderId: weightRange.id,
      skuFolderId: sku.id,
      photosFolderId: photos.id,
      videosFolderId: videos.id,
      certificatesFolderId: certificates?.id,
      informationFolderId: information.id,
    },
    media: uploadedMedia,
    masterCard: {
      name: masterCardName,
      mimeType: 'application/pdf',
      driveFileId: masterCard.id,
      driveWebViewLink: masterCard.webViewLink,
      thumbnailLink: masterCard.thumbnailLink,
    },
  }
}

export async function syncCatalogueFiles(req, res, products) {
  const client = await driveClient(req, res)
  const sortedProducts = sortProducts(products)
  const root = await client.ensureFolder(await resolvedDriveRootFolderName(req))
  await client.upsertText(CATALOGUE_INDEX_NAME, JSON.stringify({ exportedAt: new Date().toISOString(), products: sortedProducts }, null, 2), 'application/json', root.id)
  await client.upsertText(PRICE_SHEET_NAME, priceSheet(sortedProducts), 'text/csv', root.id)
}

export async function reconcileProductsWithDrive(req, res, products) {
  const client = await driveClient(req, res)
  const kept = []
  const removed = []

  for (const product of products) {
    const skuFolderId = product.driveFolders?.skuFolderId
    const skuFolder = skuFolderId ? await client.fileMetadata(skuFolderId) : null
    if (!skuFolder || skuFolder.trashed) {
      removed.push(product)
    } else {
      kept.push(product)
    }
  }

  return { products: sortProducts(kept), removed }
}

async function driveClient(req, res) {
  const token = readDriveTokens(req)
  if (!token) throw new Error('Google Drive is not connected.')

  if (!token.access_token || Date.now() >= token.expires_at) {
    const oauth = await getGoogleOAuthConfig(req)
    if (!token.refresh_token) throw new Error('Google Drive token expired. Reconnect Drive.')
    const refreshed = await tokenRequest({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    })
    const nextToken = {
      ...token,
      ...refreshed,
      refresh_token: refreshed.refresh_token || token.refresh_token,
      expires_at: Date.now() + Math.max(1, (refreshed.expires_in || 3600) - 300) * 1000,
    }
    writeDriveTokens(req, res, nextToken)
    return new DriveClient(nextToken.access_token)
  }

  return new DriveClient(token.access_token)
}

class DriveClient {
  constructor(accessToken) {
    this.accessToken = accessToken
  }

  async ensureFolder(name, parentId = 'root') {
    const existing = await this.findFolder(name, parentId)
    if (existing) return existing
    return this.request(`${DRIVE_API}/files?fields=id,name,mimeType,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    })
  }

  async findFolder(name, parentId) {
    const query = [`name = '${escapeDriveQuery(name)}'`, `mimeType = '${FOLDER_MIME}'`, `'${escapeDriveQuery(parentId)}' in parents`, 'trashed = false'].join(' and ')
    const result = await this.request(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink)&pageSize=1`)
    return result.files?.[0]
  }

  async findFileByName(name, parentId) {
    const query = [`name = '${escapeDriveQuery(name)}'`, `'${escapeDriveQuery(parentId)}' in parents`, 'trashed = false'].join(' and ')
    const result = await this.request(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink,webContentLink,thumbnailLink)&pageSize=1`)
    return result.files?.[0]
  }

  async fileMetadata(fileId) {
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed,webViewLink`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Google Drive request failed (${response.status}): ${detail}`)
    }
    return response.json()
  }

  async uploadBuffer({ name, buffer, mimeType, parentId }) {
    const metadata = { name, mimeType, parents: [parentId] }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    form.append('file', new Blob([buffer], { type: mimeType }), name)
    return this.request(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,thumbnailLink`, {
      method: 'POST',
      body: form,
    })
  }

  async upsertText(name, text, mimeType, parentId) {
    const existing = await this.findFileByName(name, parentId)
    const metadata = existing ? { name, mimeType } : { name, mimeType, parents: [parentId] }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    form.append('file', new Blob([text], { type: mimeType }), name)
    const url = existing
      ? `${DRIVE_UPLOAD_API}/files/${existing.id}?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,thumbnailLink`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,thumbnailLink`
    return this.request(url, { method: existing ? 'PATCH' : 'POST', body: form })
  }

  async makeShareable(fileId) {
    await this.request(`${DRIVE_API}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    })
  }

  async downloadFile(fileId) {
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Google Drive download failed (${response.status}): ${detail}`)
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
      size: Number(response.headers.get('content-length') || 0),
    }
  }

  async request(url, init = {}) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.headers || {}),
      },
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Google Drive request failed (${response.status}): ${detail}`)
    }
    return response.json()
  }
}

async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error_description || body.error || `Google token request failed (${response.status}).`)
  return body
}

function readDriveTokens(req) {
  return req.jmjGoogleTokens || readCookieJson(req, TOKEN_COOKIE)
}

function writeDriveTokens(req, res, token) {
  req.jmjGoogleTokens = token
  writeCookieJson(res, TOKEN_COOKIE, token, TOKEN_TTL_MS)
}

function sessionUserKey(session) {
  return session?.user?.email || session?.user?.username || ''
}

function sortProducts(products) {
  return [...products].sort((a, b) => {
    const dateCompare = String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    if (dateCompare) return dateCompare
    return String(a.sku || '').localeCompare(String(b.sku || ''))
  })
}

function safeDriveName(value) {
  return String(value || '').trim().replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, '-').replace(/\s+/g, ' ') || 'Untitled'
}

function weightRangeLabel(value) {
  const weight = Number(String(value || '').replace(/[^\d.-]/g, '')) || 0
  if (!weight || weight < 0) return 'Unsorted Weight'
  const from = Math.floor(weight)
  return `${from}-${from + 1} cts`
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function createMasterCardPdfBuffer(req, product, files = []) {
  const businessName = await resolvedBusinessName(req)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFillColor('#fff7e8')
  doc.rect(0, 0, 210, 297, 'F')
  doc.setDrawColor('#b38935')
  doc.setLineWidth(0.8)
  doc.roundedRect(7, 7, 196, 283, 4, 4)
  doc.setFont('times', 'bold')
  doc.setTextColor('#941c21')
  doc.setFontSize(28)
  doc.text(businessName, 105, 32, { align: 'center' })
  doc.setDrawColor('#b38935')
  doc.line(44, 42, 166, 42)
  doc.setTextColor('#1d1a14')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(product.sku || 'SKU', 105, 58, { align: 'center' })
  doc.setFontSize(14)
  doc.text([product.gemstone, product.variety].filter(Boolean).join(' - ') || 'Gemstone', 105, 68, { align: 'center' })
  const heroImage = files.find((file) => file.kind === 'photo' && file.role === 'heroImage') || files.find((file) => file.kind === 'photo')
  if (heroImage) {
    try {
      addImageFit(doc, heroImage, 30, 82, 150, 74)
    } catch {
      drawImagePlaceholder(doc, 30, 82, 150, 74)
    }
  } else {
    drawImagePlaceholder(doc, 30, 82, 150, 74)
  }
  doc.setDrawColor('#b38935')
  doc.roundedRect(18, 172, 174, 78, 4, 4)
  doc.setTextColor('#1d1a14')
  doc.setFont('times', 'bold')
  doc.setFontSize(17)
  doc.text('TECHNICAL DETAILS', 105, 185, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  const rows = [
    ['Dimensions', product.dimensions],
    ['Shape / Cut', [product.shape, product.cut].filter(Boolean).join(' / ')],
    ['Treatment', product.treatment],
    ['Certification', product.laboratory || 'Non-Certified'],
    ['Report No.', isCertifiedProduct(product) ? product.certificateNo : ''],
  ]
  rows.forEach(([label, value], index) => {
    const y = 201 + index * 9
    doc.text(label, 32, y)
    doc.text(':', 92, y)
    doc.setFont('helvetica', 'bold')
    doc.text(value || '-', 98, y)
    doc.setFont('helvetica', 'normal')
  })
  doc.roundedRect(18, 262, 174, 18, 4, 4)
  doc.setFont('helvetica', 'bold')
  doc.text(`${product.weightCt || '-'} ct`, 34, 273)
  doc.text(`${product.pricePerCarat || '-'} / ct`, 82, 273)
  doc.text(product.origin || '-', 142, 273)
  return Buffer.from(doc.output('arraybuffer'))
}

function isCertifiedProduct(product) {
  const certification = String(product.laboratory || '').trim().toLowerCase()
  return certification && certification !== 'non-certified'
}

function addImageFit(doc, file, x, y, boxWidth, boxHeight) {
  const format = imageFormat(file.mimeType)
  if (!format) throw new Error(`Unsupported master-card image type: ${file.mimeType}`)
  const imageData = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`
  const padding = 1.2
  const innerX = x + padding
  const innerY = y + padding
  const innerWidth = boxWidth - padding * 2
  const innerHeight = boxHeight - padding * 2
  doc.setDrawColor('#b38935')
  doc.roundedRect(x, y, boxWidth, boxHeight, 4, 4)
  const props = doc.getImageProperties(imageData)
  const imageWidth = Number(props.width) || innerWidth
  const imageHeight = Number(props.height) || innerHeight
  const scale = Math.min(innerWidth / imageWidth, innerHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  const drawX = innerX + (innerWidth - width) / 2
  const drawY = innerY + (innerHeight - height) / 2
  doc.addImage(imageData, format, drawX, drawY, width, height, undefined, 'FAST')
  doc.setDrawColor('#b38935')
  doc.roundedRect(x, y, boxWidth, boxHeight, 4, 4)
}

function imageFormat(mimeType) {
  if (mimeType === 'image/png') return 'PNG'
  if (mimeType === 'image/webp') return 'WEBP'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'JPEG'
  return ''
}

function drawImagePlaceholder(doc, x, y, width, height) {
  doc.setDrawColor('#b38935')
  doc.roundedRect(x, y, width, height, 4, 4)
  doc.setTextColor('#8a671f')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('GEMSTONE IMAGE', x + width / 2, y + height / 2, { align: 'center' })
}

function priceSheet(products) {
  const rows = [['SKU', 'Category', 'Gemstone', 'Origin', 'Weight Range', 'Weight Ct', 'Price Per Carat', 'Shape', 'Treatment', 'Certification', 'Report No.', 'Master Card']]
  for (const product of products) {
    rows.push([
      product.sku,
      product.category || 'Astrological',
      product.gemstone,
      product.origin,
      weightRangeLabel(product.weightCt),
      product.weightCt,
      product.pricePerCarat,
      product.shape,
      product.treatment,
      product.laboratory,
      isCertifiedProduct(product) ? product.certificateNo : '',
      product.masterCard?.driveWebViewLink || '',
    ])
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
