import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { config } from './config.js'

const allowed = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.heic': ['image/heic', 'image/heif'],
  '.heif': ['image/heic', 'image/heif'],
  '.webp': ['image/webp'],
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime'],
  '.pdf': ['application/pdf'],
}

export const uploadFields = [
  { name: 'photos', maxCount: 30 },
  { name: 'videos', maxCount: 10 },
  { name: 'certificates', maxCount: 5 },
]

export function multerLimits() {
  return {
    fileSize: config.maxUploadBytes,
    files: 45,
    fields: 40,
  }
}

export async function validateUploadedFile(file) {
  const extension = path.extname(file.originalname || '').toLowerCase()
  const acceptedTypes = allowed[extension]
  if (!acceptedTypes) {
    throw new Error(`File type is not allowed: ${extension || 'unknown'}`)
  }

  const detected = await fileTypeFromBuffer(file.buffer)
  const detectedMime = detected?.mime || ''
  const browserMime = file.mimetype || ''
  const matchesDetected = detectedMime && acceptedTypes.includes(detectedMime)
  const matchesBrowserPdf = extension === '.pdf' && browserMime === 'application/pdf' && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'

  if (!matchesDetected && !matchesBrowserPdf) {
    throw new Error(`File content does not match allowed type for ${file.originalname}.`)
  }

  return {
    id: randomUUID(),
    originalName: file.originalname,
    safeName: safeFileName(file.originalname),
    mimeType: detectedMime || browserMime,
    size: file.size,
    buffer: file.buffer,
  }
}

export function safeFileName(name) {
  const extension = path.extname(name).toLowerCase()
  const base = path.basename(name, extension).replace(/[^a-z0-9._ -]/gi, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file'
  return `${base}${extension}`
}

export function mediaKind(fieldName) {
  if (fieldName === 'photos') return 'photo'
  if (fieldName === 'videos') return 'video'
  if (fieldName === 'certificates') return 'certificate'
  return 'file'
}
