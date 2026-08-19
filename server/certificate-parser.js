import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker } from 'tesseract.js'

const GEMSTONES = [
  'Yellow Sapphire',
  'Blue Sapphire',
  'Emerald',
  'Ruby',
  'Pink Sapphire',
  'White Sapphire',
  'Padparadscha Sapphire',
  'Alexandrite',
  'Spinel',
  'Tourmaline',
  'Tanzanite',
  'Aquamarine',
  'Topaz',
  'Garnet',
  'Opal',
]

const ORIGINS = [
  'Colombian',
  'Colombian Muzo',
  'Colombian Chivor',
  'Ceylon',
  'Sri Lankan',
  'Burma',
  'Mozambique',
  'Zambia',
  'Thailand',
  'Kashmir',
  'Madagascar',
  'Brazil',
  'Afghanistan',
]

const SHAPES = ['Cushion', 'Cushion Modified', 'Cushion Brilliant', 'Oval', 'Round', 'Pear', 'Emerald Cut', 'Octagon', 'Princess', 'Trillion', 'Marquise', 'Cabochon']
const TREATMENTS = ['No Treatment', 'No Indications of Heating', 'Heated', 'Minor Oil', 'Moderate Oil', 'F1', 'F2', 'Insignificant']
const KNOWN_CERTIFICATE_LABS = ['GSI', 'IIGJ', 'GIA', 'IGI', 'GRS', 'Gubelin', 'SSEF', 'AIGS', 'GII', 'Lotus', 'AGL']
const NEXT_LABEL =
  '(?:report\\s*(?:no\\.?|number|#)|certificate\\s*(?:no\\.?|number|#)|stone\\s*(?:no\\.?|number|#)|variety|species|gemstone|weight|carat\\s*weight|measurements?|dimensions?|shape\\s*/\\s*cut|shape\\s*(?:and|&)\\s*cut|shape|cut|origin|treatment|laborator(?:y|ies)|lab|color|colour|clarity|comments?|remarks?)'
const NEXT_LABEL_AFTER_SHAPE_CUT =
  '(?:report\\s*(?:no\\.?|number|#)|certificate\\s*(?:no\\.?|number|#)|stone\\s*(?:no\\.?|number|#)|variety|species|gemstone|weight|carat\\s*weight|measurements?|dimensions?|origin|treatment|laborator(?:y|ies)|lab|color|colour|clarity|comments?|remarks?)'

export async function parseCertificateFile(file) {
  if (file.mimeType === 'application/pdf' || file.safeName.toLowerCase().endsWith('.pdf')) {
    const rawText = await extractPdfText(file.buffer)
    return {
      fields: inferCertificateFields(rawText),
      rawText,
      confidence: confidenceFor(rawText),
      source: 'pdf-text',
    }
  }

  if (file.mimeType.startsWith('image/') && !['image/heic', 'image/heif'].includes(file.mimeType)) {
    const rawText = await extractImageText(file.buffer)
    return {
      fields: inferCertificateFields(rawText),
      rawText,
      confidence: confidenceFor(rawText),
      source: 'image-ocr',
    }
  }

  return { fields: {}, rawText: '', confidence: 0, source: 'unsupported' }
}

async function extractPdfText(buffer) {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pages = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }

  return pages.join('\n')
}

async function extractImageText(buffer) {
  const worker = await createWorker('eng')
  try {
    const result = await worker.recognize(buffer)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}

export function inferCertificateFields(rawText) {
  const text = rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ')
  const fields = {}

  fields.certificateNo =
    firstLabelValue(text, ['report\\s*(?:no\\.?|number|#)', 'certificate\\s*(?:no\\.?|number|#)', 'stone\\s*(?:no\\.?|number|#)'], 50) ||
    firstMatch(text, [
    /(?:certificate|cert\.?|report|stone)\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9][A-Z0-9/.-]{4,})/i,
    /\b(?:GIA|IGI|GRS|SSEF|AIGS|GII)\s*([A-Z0-9/.-]{5,})\b/i,
  ])

  fields.weightCt = cleanNumber(firstLabelValue(text, ['carat\\s*weight', 'weight'], 30)) || firstMatch(text, [
    /(?:weight|carat weight)\s*[:-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:ct|carat|carats)?/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*(?:ct|carats?)\b/i,
  ])

  fields.dimensions = firstLabelValue(text, ['measurements?', 'dimensions?'], 70) || firstMatch(text, [
    /(?:measurements?|dimensions?)\s*[:-]?\s*([0-9.]+\s*(?:x|X|x)\s*[0-9.]+(?:\s*(?:x|X|x)\s*[0-9.]+)?\s*mm)/i,
    /\b([0-9.]+\s*(?:x|X|x)\s*[0-9.]+(?:\s*(?:x|X|x)\s*[0-9.]+)?\s*mm)\b/i,
  ])

  const variety = firstLabelValue(text, ['variety'], 60)
  const species = firstLabelValue(text, ['species', 'gemstone'], 60)
  const shapeCut = firstLabelValue(text, ['shape\\s*/\\s*cut', 'shape\\s*(?:and|&)\\s*cut'], 70, NEXT_LABEL_AFTER_SHAPE_CUT)
  const split = splitShapeCut(shapeCut)

  fields.variety = variety
  fields.origin = firstValueFromList(text, ORIGINS) || firstLabelValue(text, ['origin'], 50)
  fields.gemstone = firstValueFromList(variety, GEMSTONES) || firstValueFromList(text, GEMSTONES) || species
  fields.shape = split.shape || firstValueFromList(text, SHAPES) || firstLabelValue(text, ['shape'], 45)
  fields.cut = split.cut || firstLabelValue(text, ['cut'], 50)
  fields.treatment = firstValueFromList(text, TREATMENTS) || firstLabelValue(text, ['treatment'], 70)
  fields.laboratory = firstValueFromList(text, KNOWN_CERTIFICATE_LABS) || firstLabelValue(text, ['laborator(?:y|ies)', 'lab'], 50)
  fields.color = firstLabelValue(text, ['color', 'colour'], 45)
  fields.clarity = firstLabelValue(text, ['clarity'], 35)

  return compactFields(fields)
}

function firstLabelValue(text, labelPatterns, max = 80, nextLabel = NEXT_LABEL) {
  for (const labelPattern of labelPatterns) {
    const pattern = new RegExp(`(?:^|[\\n\\s])${labelPattern}\\s*(?:[:\\-]|\\s)\\s*([^\\n]{1,${max}}?)(?=\\s+${nextLabel}(?:\\s*(?:[:\\-]|\\s))|\\n|$)`, 'i')
    const match = text.match(pattern)
    if (match?.[1]) return cleanValue(match[1])
  }

  return ''
}

function splitShapeCut(value) {
  const shapeCut = cleanValue(value)
  if (!shapeCut) return { shape: '', cut: '' }
  const shape = firstValueFromList(shapeCut, SHAPES)
  if (!shape) return { shape: shapeCut, cut: '' }
  const cut = cleanValue(shapeCut.replace(new RegExp(`^${escapeRegex(shape)}\\b`, 'i'), ''))
  return { shape, cut }
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return cleanValue(match[1])
  }

  return ''
}

function firstValueFromList(text, values) {
  const haystack = text.toLowerCase()
  return [...values].sort((a, b) => b.length - a.length).find((value) => haystack.includes(value.toLowerCase())) || ''
}

function compactFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => Boolean(value)))
}

function cleanValue(value) {
  return value.replace(/\s+/g, ' ').replace(/^[:;,\-\s]+/g, '').replace(/[|,:;.-]+$/g, '').trim()
}

function cleanNumber(value) {
  const match = value.match(/[0-9]+(?:\.[0-9]+)?/)
  return match?.[0] || ''
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function confidenceFor(text) {
  if (!text.trim()) return 0
  const signals = ['certificate', 'report', 'carat', 'weight', 'shape', 'treatment', 'origin', 'GIA', 'IGI', 'GRS']
  const score = signals.filter((signal) => text.toLowerCase().includes(signal.toLowerCase())).length / signals.length
  return Math.min(0.95, Math.max(0.25, score))
}
