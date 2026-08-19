import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config, assertProductionConfig } from './config.js'
import { createStore } from './store.js'
import { parseCertificateFile } from './certificate-parser.js'
import { authenticatedSession, clearSessionCookie, newSession, requireAuth, requireCsrf, setSessionCookie, verifyPassword } from './security.js'
import { createGoogleAuthUrl, downloadDriveFile, googleDriveStatus, handleGoogleCallback, reconcileProductsWithDrive, syncCatalogueFiles, uploadProductToDrive } from './drive.js'
import { changeFirebasePassword, firebaseAuthConfigured, verifyFirebasePassword } from './firebase-auth.js'
import { getPublicSettings, resolvedBusinessName, savePublicSettings } from './settings.js'
import { mediaKind, multerLimits, uploadFields, validateUploadedFile } from './upload-policy.js'

assertProductionConfig()

const app = express()
const store = createStore()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: multerLimits(),
})

await store.init()

app.disable('x-powered-by')
app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false)

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https://drive.google.com', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
        'media-src': ["'self'", 'blob:', 'https://drive.google.com'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
)

app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(
  '/assets',
  express.static(
    path.join(config.rootDir, 'website', 'public', 'assets'),
    config.nodeEnv === 'production'
      ? { immutable: true, maxAge: '1y' }
      : {
          etag: false,
          maxAge: 0,
          setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
        },
  ),
)
app.use(express.static(path.join(config.rootDir, 'website', 'public'), { extensions: ['html'] }))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Wait and try again.' },
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api', apiLimiter)

app.get('/api/session', async (req, res) => {
  const session = await authenticatedSession(req, store)
  const drive = session ? await googleDriveStatus(store) : { configured: false, connected: false }
  const settings = session ? await getPublicSettings(store) : { businessName: config.businessName, currency: config.currency, driveRootFolderName: config.driveRootFolderName }
  res.json({
    authenticated: Boolean(session),
    csrfToken: session?.csrfToken || '',
    user: session ? { username: session.user?.email || session.user?.username || config.adminUsername } : null,
    drive,
    config: {
      ...settings,
      uploadLimitMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    },
  })
})

app.post('/api/login', loginLimiter, async (req, res, next) => {
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')

  try {
    const user = firebaseAuthConfigured()
      ? await verifyFirebasePassword(username, password)
      : localAdminUser(username, password)

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' })
    }

    const session = newSession()
    session.user = publicUser(user)
    await store.saveSession(session)
    setSessionCookie(res, session.id)
    res.json({ authenticated: true, csrfToken: session.csrfToken, username: user.email || user.username })
  } catch (error) {
    next(error)
  }
})

app.post('/api/logout', requireAuth(store), requireCsrf, async (req, res) => {
  await store.deleteSession(req.session.hash)
  clearSessionCookie(res)
  res.json({ ok: true })
})

app.get('/api/google/auth-url', requireAuth(store), async (req, res, next) => {
  try {
    res.json({ url: await createGoogleAuthUrl(store, req.session.hash) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/google/callback', async (req, res) => {
  try {
    const session = await authenticatedSession(req, store)
    if (!session) throw new Error('Sign in again before connecting Google Drive.')
    await handleGoogleCallback(
      store,
      {
        code: String(req.query.code || ''),
        state: String(req.query.state || ''),
      },
      session.hash,
    )
    res.redirect('/?drive=connected')
  } catch (error) {
    res.redirect(`/?drive_error=${encodeURIComponent(error.message)}`)
  }
})

app.get('/api/products', requireAuth(store), async (_req, res) => {
  res.json({ products: await store.listProducts() })
})

app.post('/api/products/sync', requireAuth(store), requireCsrf, async (_req, res, next) => {
  try {
    const drive = await googleDriveStatus(store)
    if (!drive.connected) return res.status(409).json({ error: 'Connect Google Drive before syncing catalogue.' })

    const before = await store.listProducts()
    const result = await reconcileProductsWithDrive(store, before)
    await store.replaceProducts(result.products)
    await syncCatalogueFiles(store, result.products)

    res.json({
      products: await store.listProducts(),
      removed: result.removed.map((product) => ({ id: product.id, sku: product.sku })),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/drive/files/:fileId/content', requireAuth(store), async (req, res, next) => {
  try {
    const fileId = String(req.params.fileId || '')
    const products = await store.listProducts()
    const allowed = products.some((product) => [...(product.media || []), product.masterCard].filter(Boolean).some((item) => item.driveFileId === fileId))
    if (!allowed) return res.status(404).json({ error: 'File not found.' })
    const file = await downloadDriveFile(store, fileId)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    if (file.size) res.setHeader('Content-Length', String(file.size))
    res.send(file.buffer)
  } catch (error) {
    next(error)
  }
})

app.get('/api/settings', requireAuth(store), async (_req, res) => {
  res.json({ settings: await getPublicSettings(store), drive: await googleDriveStatus(store) })
})

app.put('/api/settings', requireAuth(store), requireCsrf, async (req, res, next) => {
  try {
    const settings = await savePublicSettings(store, req.body || {})
    res.json({ settings, drive: await googleDriveStatus(store) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/password', requireAuth(store), requireCsrf, async (req, res, next) => {
  try {
    if (!firebaseAuthConfigured()) return res.status(409).json({ error: 'Password changes are available for Firebase login only.' })
    const email = req.session.user?.email
    if (!email) return res.status(409).json({ error: 'Sign in with your Firebase email before changing password.' })

    const currentPassword = String(req.body?.currentPassword || '')
    const newPassword = String(req.body?.newPassword || '')
    if (!currentPassword) return res.status(400).json({ error: 'Enter your current password.' })
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' })
    if (currentPassword === newPassword) return res.status(400).json({ error: 'New password must be different from current password.' })

    const firebaseUser = await verifyFirebasePassword(email, currentPassword)
    if (!firebaseUser?.idToken) return res.status(401).json({ error: 'Current password is incorrect.' })
    await changeFirebasePassword(firebaseUser.idToken, newPassword)

    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/certificate/parse', requireAuth(store), requireCsrf, upload.single('certificate'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Add a certificate file first.' })
    const certificate = await validateUploadedFile(req.file)
    const isCertificateFile = certificate.mimeType === 'application/pdf' || certificate.mimeType.startsWith('image/')
    if (!isCertificateFile) return res.status(400).json({ error: 'Certificate must be a PDF or image file.' })
    const result = await parseCertificateFile(certificate)
    res.json({
      ...result,
      rawText: result.rawText.slice(0, 6000),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/products', requireAuth(store), requireCsrf, upload.fields(uploadFields), async (req, res, next) => {
  try {
    const drive = await googleDriveStatus(store)
    if (!drive.connected) return res.status(409).json({ error: 'Connect Google Drive before uploading product media.' })

    const fields = normalizeProductFields(req.body || {})
    if (!fields.sku || !fields.gemstone) return res.status(400).json({ error: 'SKU and gemstone are required.' })

    const files = []
    for (const [fieldName, fieldFiles] of Object.entries(req.files || {})) {
      for (const rawFile of fieldFiles) {
        const safeFile = await validateUploadedFile(rawFile)
        const kind = mediaKind(fieldName)
        if (kind === 'certificate' && !isCertifiedLab(fields.laboratory)) continue
        files.push({
          ...safeFile,
          kind,
          role:
            fieldName === 'photos' && !files.some((file) => file.kind === 'photo')
              ? 'heroImage'
              : fieldName === 'videos' && !files.some((file) => file.kind === 'video')
                ? 'heroVideo'
                : 'supporting',
        })
      }
    }

    const now = new Date().toISOString()
    const productBase = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'uploading',
      ...fields,
    }
    const driveResult = await uploadProductToDrive(store, productBase, files)
    const product = {
      ...productBase,
      status: 'saved',
      updatedAt: new Date().toISOString(),
      driveFolders: driveResult.driveFolders,
      media: driveResult.media,
      masterCard: driveResult.masterCard,
    }

    await store.saveProduct(product)
    await syncCatalogueFiles(store, await store.listProducts())
    res.status(201).json({ product })
  } catch (error) {
    next(error)
  }
})

app.get('/api/products/:id/share/:packageName', requireAuth(store), async (req, res) => {
  const product = await store.getProduct(req.params.id)
  if (!product) return res.status(404).json({ error: 'Product not found.' })
  const packageName = req.params.packageName
  const media = filesForPackage(product, packageName)
  const links = media.map((item) => item.driveWebViewLink || item.driveWebContentLink).filter(Boolean)
  const message = await productShareMessage(store, product, packageName, links)
  res.json({
    message,
    links,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
  })
})

app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

app.use((error, _req, res, _next) => {
  const status = error.status || error.statusCode || 500
  const message = status >= 500 && config.nodeEnv === 'production' ? 'Server error.' : error.message
  if (status >= 500) console.error(error)
  res.status(status).json({ error: message })
})

app.listen(config.port, () => {
  console.log(`JMJ OS website running at http://localhost:${config.port}`)
})

function normalizeProductFields(body) {
  const laboratory = clean(body.laboratory) || 'Non-Certified'
  const certified = isCertifiedLab(laboratory)
  return {
    sku: clean(body.sku).toUpperCase(),
    category: clean(body.category) || 'Astrological',
    gemstone: clean(body.gemstone),
    variety: clean(body.variety),
    origin: clean(body.origin),
    weightCt: clean(body.weightCt),
    pricePerCarat: clean(body.pricePerCarat),
    shape: clean(body.shape),
    cut: clean(body.cut),
    dimensions: clean(body.dimensions),
    treatment: clean(body.treatment),
    laboratory,
    certificateNo: certified ? clean(body.certificateNo) : '',
    color: clean(body.color),
    clarity: clean(body.clarity),
    notes: clean(body.notes, 2000),
    internalNotes: clean(body.internalNotes, 2000),
  }
}

function localAdminUser(username, password) {
  const passwordOk = config.adminPasswordHash
    ? verifyPassword(password, config.adminPasswordHash)
    : config.nodeEnv !== 'production' && password === 'change-me-now-12345'
  if (username !== config.adminUsername || !passwordOk) return null
  return { username: config.adminUsername }
}

function publicUser(user) {
  return {
    ...(user.uid ? { uid: user.uid } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.username ? { username: user.username } : {}),
  }
}

function isCertifiedLab(value) {
  return value && value.toLowerCase() !== 'non-certified'
}

function clean(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function filesForPackage(product, packageName) {
  const master = product.masterCard ? [product.masterCard] : []
  if (packageName === 'main') {
    const heroVideo = product.media.find((item) => item.role === 'heroVideo') || product.media.find((item) => item.kind === 'video')
    return [heroVideo, ...master].filter(Boolean)
  }
  if (packageName === 'allMedia') return [...product.media.filter((item) => item.kind === 'photo' || item.kind === 'video'), ...master]
  return [...product.media.filter((item) => item.kind === 'photo' || item.kind === 'video' || item.kind === 'certificate'), ...master]
}

async function productShareMessage(store, product, packageName, links) {
  const packageLabel =
    packageName === 'main'
      ? 'Main video + master card'
      : packageName === 'allMedia'
        ? 'All pictures/videos + master card'
        : 'All pictures/videos + master card + certificate'
  return [
    await resolvedBusinessName(store),
    `${product.sku} - ${product.gemstone}`,
    product.weightCt ? `Weight: ${product.weightCt} ct` : '',
    product.origin ? `Origin: ${product.origin}` : '',
    product.shape ? `Shape: ${product.shape}` : '',
    product.treatment ? `Treatment: ${product.treatment}` : '',
    isCertifiedLab(product.laboratory) && product.certificateNo ? `Report No.: ${product.certificateNo}` : '',
    product.pricePerCarat ? `Price / ct: ${product.pricePerCarat}` : '',
    `Package: ${packageLabel}`,
    links.length ? `Files:\n${links.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
