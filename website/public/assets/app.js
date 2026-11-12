let csrfToken = ''
let products = []
let driveState = { configured: false, connected: false }
let appConfig = {
  businessName: 'Jay Mataji Jewels',
  currency: 'INR',
  driveRootFolderName: 'JMJ Digital Catalogue',
  shareDriveLinksPublic: true,
  googleClientId: '',
  googleRedirectUri: 'http://localhost:8787/api/google/callback',
  googleClientSecretSet: false,
  uploadLimitMb: 100,
}

const DETAIL_KEYS = [
  'sku',
  'category',
  'gemstone',
  'variety',
  'origin',
  'weightCt',
  'pricePerCarat',
  'shape',
  'cut',
  'dimensions',
  'treatment',
  'laboratory',
  'certificateNo',
  'color',
  'clarity',
  'notes',
  'internalNotes',
]

const EMPTY_DETAILS = Object.freeze({
  sku: '',
  category: 'Astrological',
  gemstone: '',
  variety: '',
  origin: '',
  weightCt: '',
  pricePerCarat: '',
  shape: '',
  cut: '',
  dimensions: '',
  treatment: '',
  laboratory: 'Non-Certified',
  certificateNo: '',
  color: '',
  clarity: '',
  notes: '',
  internalNotes: '',
})

const EMPTY_FILTERS = Object.freeze({
  query: '',
  gemstone: '',
  origin: '',
  shape: '',
  treatment: '',
  lab: '',
  minWeight: '',
  maxWeight: '',
  minPrice: '',
  maxPrice: '',
})

const els = {
  loginView: document.querySelector('#login-view'),
  appView: document.querySelector('#app-view'),
  loginForm: document.querySelector('#login-form'),
  loginMessage: document.querySelector('#login-message'),
  driveStatus: document.querySelector('#drive-status'),
  topMessage: document.querySelector('#top-message'),
  uploadLimit: document.querySelector('#upload-limit'),
  screens: {
    home: document.querySelector('#home-screen'),
    add: document.querySelector('#add-screen'),
    search: document.querySelector('#search-screen'),
    settings: document.querySelector('#settings-screen'),
  },
  addSteps: [
    document.querySelector('#add-step-media'),
    document.querySelector('#add-step-details'),
    document.querySelector('#add-step-certification'),
    document.querySelector('#add-step-internal'),
    document.querySelector('#add-step-preview'),
  ],
  stepTabs: document.querySelector('#step-tabs'),
  previousStep: document.querySelector('#previous-step'),
  nextStep: document.querySelector('#next-step'),
  saveProduct: document.querySelector('#save-product'),
  autofillCertificate: document.querySelector('#autofill-certificate'),
  autofillCertificateMedia: document.querySelector('#autofill-certificate-media'),
  formMessage: document.querySelector('#form-message'),
  parseStatus: document.querySelector('#parse-status'),
  parseStatusMedia: document.querySelector('#parse-status-media'),
  certificateTextPreview: document.querySelector('#certificate-text-preview'),
  certificationSelect: document.querySelector('#certification-select'),
  otherLabBlock: document.querySelector('#other-lab-block'),
  otherLabInput: document.querySelector('#other-lab-input'),
  reportNoBlock: document.querySelector('#report-no-block'),
  certificateFileBlock: document.querySelector('#certificate-file-block'),
  mediaList: document.querySelector('#media-list'),
  masterCardPreview: document.querySelector('#master-card-preview'),
  previewFolder: document.querySelector('#preview-folder'),
  previewFiles: document.querySelector('#preview-files'),
  previewTotal: document.querySelector('#preview-total'),
  filtersPanel: document.querySelector('#filters-panel'),
  productGrid: document.querySelector('#product-grid'),
  productCount: document.querySelector('#product-count'),
  selectionBar: document.querySelector('#selection-bar'),
  selectionCount: document.querySelector('#selection-count'),
  selectionWeight: document.querySelector('#selection-weight'),
  clearSelection: document.querySelector('#clear-selection'),
  productDetailModal: document.querySelector('#product-detail-modal'),
  uploadModal: document.querySelector('#upload-modal'),
  settings: {
    businessName: document.querySelector('#setting-business-name'),
    currency: document.querySelector('#setting-currency'),
    driveRootFolderName: document.querySelector('#setting-drive-root'),
    shareDriveLinksPublic: document.querySelector('#setting-share-links'),
    currentPassword: document.querySelector('#setting-current-password'),
    newPassword: document.querySelector('#setting-new-password'),
    confirmPassword: document.querySelector('#setting-confirm-password'),
    passwordMessage: document.querySelector('#password-message'),
  },
}

const objectUrls = new WeakMap()
const selectedIds = new Set()
const filters = { ...EMPTY_FILTERS }
let showFilters = true
let draft = freshDraft()

boot()
bindEvents()

function bindEvents() {
  els.loginForm.addEventListener('submit', login)
  document.querySelector('#logout').addEventListener('click', logout)
  document.querySelector('#connect-drive').addEventListener('click', connectDrive)
  document.querySelector('#refresh-products').addEventListener('click', async () => {
    await syncProducts()
  })
  document.querySelector('#brand-home').addEventListener('click', () => setScreen('home'))
  document.querySelector('#open-settings').addEventListener('click', () => setScreen('settings'))
  document.querySelector('#home-add').addEventListener('click', () => setScreen('add'))
  document.querySelector('#home-search').addEventListener('click', () => setScreen('search'))
  document.querySelectorAll('.js-home').forEach((button) => button.addEventListener('click', () => setScreen('home')))

  document.querySelector('#hero-photo').addEventListener('change', (event) => {
    draft.files.heroPhoto = event.target.files?.[0] || null
    renderAdd()
  })
  document.querySelector('#supporting-photos').addEventListener('change', (event) => {
    draft.files.photos = Array.from(event.target.files || [])
    renderAdd()
  })
  document.querySelector('#product-videos').addEventListener('change', (event) => {
    draft.files.videos = Array.from(event.target.files || [])
    renderAdd()
  })
  document.querySelector('#certificate-file').addEventListener('change', (event) => {
    updateCertificateFile(event.target.files?.[0] || null)
  })
  document.querySelector('#certificate-file-cert').addEventListener('change', (event) => {
    updateCertificateFile(event.target.files?.[0] || null)
  })
  els.certificationSelect.addEventListener('change', (event) => {
    const value = event.target.value
    draft.details.laboratory = value === 'Other' ? els.otherLabInput.value.trim() || 'Other' : value
    renderAdd()
  })
  els.otherLabInput.addEventListener('input', (event) => {
    draft.details.laboratory = event.target.value.trim() || 'Other'
    renderAdd()
  })

  document.querySelectorAll('[data-detail]').forEach((input) => {
    input.addEventListener('input', (event) => updateDetail(event.target.dataset.detail, event.target.value))
  })

  els.stepTabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-step]')
    if (!button) return
    setStep(Number(button.dataset.step))
  })

  els.previousStep.addEventListener('click', () => setStep(Math.max(0, draft.step - 1)))
  els.nextStep.addEventListener('click', () => setStep(Math.min(4, draft.step + 1)))
  els.saveProduct.addEventListener('click', saveProduct)
  document.querySelector('#autofill-certificate').addEventListener('click', autofillFromCertificate)
  document.querySelector('#autofill-certificate-media').addEventListener('click', autofillFromCertificate)

  document.querySelector('#toggle-filters').addEventListener('click', () => {
    showFilters = !showFilters
    renderProducts()
  })
  document.querySelectorAll('[data-filter]').forEach((input) => {
    input.addEventListener('input', (event) => {
      filters[event.target.dataset.filter] = event.target.value
      renderProducts()
    })
  })
  els.clearSelection.addEventListener('click', () => {
    selectedIds.clear()
    renderProducts()
  })
  document.querySelector('#share-selected').addEventListener('click', shareSelectedProducts)
  document.querySelector('#save-settings').addEventListener('click', saveSettings)
  document.querySelector('#change-password').addEventListener('click', changePassword)
}

async function boot() {
  const params = new URLSearchParams(window.location.search)
  const driveMessage = params.get('drive') === 'connected' ? 'Google Drive connected.' : ''
  const driveError = params.get('drive_error') || ''
  if (driveMessage || driveError) window.history.replaceState({}, '', '/')

  const session = await api('/api/session').catch(() => null)
  if (!session?.authenticated) {
    showLogin()
    return
  }

  await loadApp(session)
  if (driveError) showMessage(driveError, 'error')
  else if (driveMessage) showMessage(driveMessage)
}

async function login(event) {
  event.preventDefault()
  els.loginMessage.textContent = ''
  const formData = new FormData(els.loginForm)
  const result = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      username: formData.get('username'),
      password: formData.get('password'),
    }),
    headers: { 'Content-Type': 'application/json' },
  }).catch((error) => {
    els.loginMessage.textContent = error.message
  })
  if (!result) return
  csrfToken = result.csrfToken
  await loadApp()
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => null)
  csrfToken = ''
  products = []
  selectedIds.clear()
  showLogin()
}

async function connectDrive() {
  try {
    showMessage('Opening Google Drive login...')
    const result = await api('/api/google/auth-url')
    window.location.href = result.url
  } catch (error) {
    showMessage(`${error.message} Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.`, 'error')
    setScreen('settings')
  }
}

async function loadApp(session) {
  showApp()
  const currentSession = session || (await api('/api/session'))
  csrfToken = currentSession.csrfToken
  appConfig = {
    ...appConfig,
    ...currentSession.config,
  }
  els.uploadLimit.textContent = `Max ${appConfig.uploadLimitMb} MB per file`
  updateDrive(currentSession.drive)
  renderSettings()
  await loadProducts()
  setScreen('home')
}

async function loadProducts() {
  const result = await api('/api/products')
  products = Array.isArray(result.products) ? result.products : []
  renderProducts()
}

async function syncProducts() {
  if (!driveState.connected) {
    showMessage('Please connect Google Drive first.', 'error')
    return
  }
  showMessage('Checking Google Drive...')
  try {
    const result = await api('/api/products/sync', { method: 'POST' })
    products = Array.isArray(result.products) ? result.products : []
    selectedIds.clear()
    renderProducts()
    const removedCount = Array.isArray(result.removed) ? result.removed.length : 0
    const message = removedCount ? `Catalogue synced. Removed ${removedCount} product${removedCount === 1 ? '' : 's'} missing from Drive.` : 'Catalogue synced.'
    showMessage(message)
  } catch (error) {
    showMessage(error.message, 'error')
  }
}

function showLogin() {
  els.loginView.classList.remove('hidden')
  els.appView.classList.add('hidden')
}

function showApp() {
  els.loginView.classList.add('hidden')
  els.appView.classList.remove('hidden')
}

function setScreen(screen) {
  Object.entries(els.screens).forEach(([name, element]) => element.classList.toggle('hidden', name !== screen))
  if (screen === 'add') renderAdd()
  if (screen === 'search') renderProducts()
  if (screen === 'settings') renderSettings()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function updateDrive(drive) {
  driveState = drive || { configured: false, connected: false }
  const text = driveState.connected ? 'Drive connected' : driveState.configured ? 'Drive not connected' : 'Drive not configured'
  els.driveStatus.textContent = text
  els.driveStatus.classList.toggle('connected', Boolean(driveState.connected))
}

function showMessage(message, tone = 'success') {
  els.topMessage.textContent = message
  els.topMessage.dataset.tone = tone
  window.clearTimeout(showMessage.timer)
  showMessage.timer = window.setTimeout(() => {
    els.topMessage.textContent = ''
    delete els.topMessage.dataset.tone
  }, 4500)
}

function renderSettings() {
  els.settings.businessName.value = appConfig.businessName || 'Jay Mataji Jewels'
  els.settings.currency.value = appConfig.currency || 'INR'
  els.settings.driveRootFolderName.value = appConfig.driveRootFolderName || 'JMJ Digital Catalogue'
  els.settings.shareDriveLinksPublic.checked = Boolean(appConfig.shareDriveLinksPublic)
  els.settings.currentPassword.value = ''
  els.settings.newPassword.value = ''
  els.settings.confirmPassword.value = ''
  els.settings.passwordMessage.textContent = ''
  delete els.settings.passwordMessage.dataset.tone
}

function readSettingsDraft() {
  return {
    businessName: els.settings.businessName.value,
    currency: els.settings.currency.value.toUpperCase(),
    driveRootFolderName: els.settings.driveRootFolderName.value,
    shareDriveLinksPublic: els.settings.shareDriveLinksPublic.checked,
  }
}

async function saveSettings() {
  els.settings.message.textContent = 'Saving settings...'
  try {
    const result = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(readSettingsDraft()),
      headers: { 'Content-Type': 'application/json' },
    })
    appConfig = { ...appConfig, ...result.settings }
    updateDrive(result.drive)
    renderSettings()
    setSettingsMessage('Settings saved.')
    showMessage('Settings saved.')
    renderPreview()
    return true
  } catch (error) {
    setSettingsMessage(error.message, 'error')
    return false
  }
}

async function changePassword() {
  const currentPassword = els.settings.currentPassword.value
  const newPassword = els.settings.newPassword.value
  const confirmPassword = els.settings.confirmPassword.value
  setPasswordMessage('Changing password...')

  if (!currentPassword) {
    setPasswordMessage('Enter your current password.', 'error')
    return
  }
  if (newPassword.length < 8) {
    setPasswordMessage('New password must be at least 8 characters.', 'error')
    return
  }
  if (newPassword !== confirmPassword) {
    setPasswordMessage('New password and confirmation do not match.', 'error')
    return
  }

  try {
    await api('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
      headers: { 'Content-Type': 'application/json' },
    })
    els.settings.currentPassword.value = ''
    els.settings.newPassword.value = ''
    els.settings.confirmPassword.value = ''
    setPasswordMessage('Password changed.')
    showMessage('Password changed.')
  } catch (error) {
    setPasswordMessage(error.message, 'error')
  }
}

function setSettingsMessage(message, tone = 'success') {
  els.settings.message.textContent = message
  els.settings.message.dataset.tone = tone
}

function setPasswordMessage(message, tone = 'success') {
  els.settings.passwordMessage.textContent = message
  els.settings.passwordMessage.dataset.tone = tone
}

function freshDraft() {
  return {
    step: 0,
    details: { ...EMPTY_DETAILS },
    files: {
      heroPhoto: null,
      photos: [],
      videos: [],
      certificate: null,
    },
    rawText: '',
    parseStatus: '',
  }
}

function setStep(step) {
  draft.step = Math.max(0, Math.min(4, step))
  renderAdd()
}

function updateDetail(name, value) {
  if (!name) return
  const normalizedValue = name === 'sku' ? normalizeSku(value) : value
  draft.details[name] = normalizedValue
  if (name === 'laboratory' && !isCertifiedDetails(draft.details)) {
    draft.details.certificateNo = ''
    draft.files.certificate = null
    draft.rawText = ''
  }
  if (name === 'gemstone' && !draft.details.sku.trim() && normalizedValue.trim()) {
    draft.details.sku = suggestSku(normalizedValue)
    const skuInput = document.querySelector('[data-detail="sku"]')
    if (skuInput) skuInput.value = draft.details.sku
  }
  renderPreview()
}

function updateCertificateFile(file) {
  draft.files.certificate = file
  draft.parseStatus = file ? 'Certificate added. Use autofill when ready.' : ''
  renderAdd()
}

function renderAdd() {
  els.addSteps.forEach((panel, index) => panel.classList.toggle('hidden', index !== draft.step))
  els.stepTabs.querySelectorAll('button[data-step]').forEach((button) => button.classList.toggle('active', Number(button.dataset.step) === draft.step))
  els.previousStep.disabled = draft.step === 0
  els.nextStep.classList.toggle('hidden', draft.step === 4)
  setDetailInputValues()
  renderCertificationControls()
  renderMediaList()
  renderCertificateText()
  renderPreview()
  els.parseStatus.textContent = draft.parseStatus
  els.parseStatusMedia.textContent = draft.parseStatus
}

function setDetailInputValues() {
  document.querySelectorAll('[data-detail]').forEach((input) => {
    const key = input.dataset.detail
    if (document.activeElement !== input) input.value = draft.details[key] || ''
  })
}

function renderCertificationControls() {
  const lab = draft.details.laboratory || 'Non-Certified'
  const known = ['Non-Certified', 'GSI', 'IIGJ']
  const isOther = lab === 'Other' || !known.includes(lab)
  const certified = isCertifiedDetails(draft.details)
  els.certificationSelect.value = isOther ? 'Other' : lab
  els.otherLabBlock.classList.toggle('hidden', !isOther)
  if (document.activeElement !== els.otherLabInput) els.otherLabInput.value = isOther && lab !== 'Other' ? lab : ''
  els.reportNoBlock.classList.toggle('hidden', !certified)
  els.certificateFileBlock.classList.toggle('hidden', !certified)
  els.autofillCertificate.disabled = !draft.files.certificate
  els.autofillCertificateMedia.disabled = !draft.files.certificate
}

function renderMediaList() {
  const files = selectedFileRows()
  els.mediaList.replaceChildren()
  if (!files.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.innerHTML = '<strong>No files added</strong><span>Add the main photo, extra photos, videos, and certificate.</span>'
    els.mediaList.append(empty)
    return
  }

  files.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'media-row'
    row.innerHTML = `
      <span class="file-kind">${escapeHtml(item.badge)}</span>
      <div>
        <strong>${escapeHtml(item.file.name)}</strong>
        <span>${escapeHtml(item.label)} - ${escapeHtml(fileSize(item.file.size))}</span>
      </div>
    `
    if (item.canPromote) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'tiny-pill'
      button.textContent = 'Make Main'
      button.addEventListener('click', () => promotePhoto(item.index))
      row.append(button)
    } else if (item.roleLabel) {
      const role = document.createElement('span')
      role.className = 'tiny-pill active'
      role.textContent = item.roleLabel
      row.append(role)
    }
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-button small'
    remove.textContent = 'x'
    remove.setAttribute('aria-label', `Remove ${item.file.name}`)
    remove.addEventListener('click', () => removeFile(item))
    row.append(remove)
    els.mediaList.append(row)
  })
}

function selectedFileRows() {
  const rows = []
  if (draft.files.heroPhoto) {
    rows.push({ file: draft.files.heroPhoto, group: 'heroPhoto', label: 'Main Photo', badge: 'P', roleLabel: 'Hero' })
  }
  draft.files.photos.forEach((file, index) => rows.push({ file, group: 'photos', index, label: 'Other Photo', badge: 'P', canPromote: true }))
  draft.files.videos.forEach((file, index) => rows.push({ file, group: 'videos', index, label: index === 0 ? 'Main Video' : 'Video', badge: 'V', roleLabel: index === 0 ? 'Main' : '' }))
  if (draft.files.certificate) {
    rows.push({ file: draft.files.certificate, group: 'certificate', label: 'Certificate', badge: 'C', roleLabel: 'Scan' })
  }
  return rows
}

function promotePhoto(index) {
  const promoted = draft.files.photos[index]
  if (!promoted) return
  const nextOtherPhotos = [...draft.files.photos]
  nextOtherPhotos.splice(index, 1)
  if (draft.files.heroPhoto) nextOtherPhotos.unshift(draft.files.heroPhoto)
  draft.files.heroPhoto = promoted
  draft.files.photos = nextOtherPhotos
  renderAdd()
}

function removeFile(item) {
  if (item.group === 'heroPhoto') draft.files.heroPhoto = null
  if (item.group === 'certificate') {
    draft.files.certificate = null
    draft.rawText = ''
    draft.parseStatus = ''
  }
  if (item.group === 'photos') draft.files.photos = draft.files.photos.filter((_, index) => index !== item.index)
  if (item.group === 'videos') draft.files.videos = draft.files.videos.filter((_, index) => index !== item.index)
  renderAdd()
}

async function autofillFromCertificate() {
  if (!draft.files.certificate) {
    draft.parseStatus = 'Add a certificate first.'
    renderAdd()
    return
  }

  draft.parseStatus = 'Scanning certificate...'
  renderAdd()
  const formData = new FormData()
  formData.append('certificate', draft.files.certificate)

  try {
    const result = await api('/api/certificate/parse', {
      method: 'POST',
      body: formData,
      headers: {},
    })
    draft.rawText = result.rawText || ''
    fillBlankDetails(result.fields || {})
    if (!draft.details.sku && draft.details.gemstone) draft.details.sku = suggestSku(draft.details.gemstone)
    draft.parseStatus =
      result.source === 'unsupported' ? 'This certificate type cannot be scanned yet. Fill details manually.' : `Autofill complete. Confidence ${Math.round((result.confidence || 0) * 100)}%.`
  } catch (error) {
    draft.parseStatus = error.message
  }

  renderAdd()
}

function fillBlankDetails(fields) {
  Object.entries(fields).forEach(([key, value]) => {
    if (!DETAIL_KEYS.includes(key) || !value) return
    if (key === 'laboratory' && !isCertifiedDetails(draft.details)) {
      draft.details.laboratory = String(value)
      return
    }
    if (!draft.details[key]) draft.details[key] = String(value)
  })
}

function renderCertificateText() {
  const textPanel = els.certificateTextPreview
  const text = draft.rawText.trim()
  textPanel.classList.toggle('hidden', !text)
  textPanel.querySelector('p').textContent = text ? text.slice(0, 900) : ''
}

function renderPreview() {
  const details = draft.details
  const heroUrl = draft.files.heroPhoto ? objectUrlFor(draft.files.heroPhoto) : ''
  const total = totalPrice(details)
  const certified = isCertifiedDetails(details)
  els.masterCardPreview.innerHTML = `
    <div class="master-card-border">
      <div class="preview-logo">JMJ</div>
      <h2>${escapeHtml(appConfig.businessName)}</h2>
      <div class="preview-image">${heroUrl ? `<img src="${escapeAttr(heroUrl)}" alt="">` : gemPlaceholder(details.gemstone)}</div>
      <strong class="preview-sku">${escapeHtml(details.sku || 'SKU')}</strong>
      <span class="preview-name">${escapeHtml([details.gemstone, details.variety].filter(Boolean).join(' - ') || 'Gemstone')}</span>
      <div class="technical-box">
        <h3>TECHNICAL DETAILS</h3>
        ${infoRow('Dimensions', details.dimensions)}
        ${infoRow('Shape / Cut', [details.shape, details.cut].filter(Boolean).join(' / '))}
        ${infoRow('Treatment', details.treatment)}
        ${infoRow('Certification', details.laboratory || 'Non-Certified')}
        ${infoRow('Report No.', certified ? details.certificateNo : '')}
      </div>
      <div class="price-strip">
        <span>${escapeHtml(details.weightCt || '-')} ct</span>
        <span>${details.pricePerCarat ? `${escapeHtml(currency(toNumber(details.pricePerCarat)))} / ct` : '-'}</span>
        <span>${escapeHtml(currency(total))}</span>
      </div>
    </div>
  `
  els.previewFolder.textContent = driveFolderPath(details)
  els.previewFiles.textContent = `${countPhotos()} photos, ${draft.files.videos.length} videos, ${certified && draft.files.certificate ? 1 : 0} certificate`
  els.previewTotal.textContent = currency(total)
}

async function saveProduct() {
  els.formMessage.textContent = ''
  if (!driveState.connected) {
    els.formMessage.textContent = 'Connect Google Drive before saving.'
    return
  }
  if (!draft.details.gemstone.trim() || !draft.details.sku.trim()) {
    draft.parseStatus = 'Gemstone and SKU are required.'
    setStep(1)
    return
  }

  const uploadFiles = selectedFileRows()
  showUploadModal('saving', uploadFiles)
  els.saveProduct.disabled = true
  const formData = new FormData()
  DETAIL_KEYS.forEach((key) => formData.append(key, draft.details[key] || ''))
  if (draft.files.heroPhoto) formData.append('photos', draft.files.heroPhoto)
  draft.files.photos.forEach((file) => formData.append('photos', file))
  draft.files.videos.forEach((file) => formData.append('videos', file))
  if (isCertifiedDetails(draft.details) && draft.files.certificate) formData.append('certificates', draft.files.certificate)

  try {
    const result = await api('/api/products', {
      method: 'POST',
      body: formData,
      headers: {},
    })
    products = mergeProduct(products, result.product)
    selectedIds.clear()
    showUploadModal('saved', uploadFiles, '', result.product)
    showMessage(`${productValue(result.product, 'sku')} saved to Google Drive.`)
    draft = freshDraft()
    renderAdd()
    renderProducts()
  } catch (error) {
    showUploadModal('failed', uploadFiles, error.message)
    els.formMessage.textContent = error.message
  } finally {
    els.saveProduct.disabled = false
  }
}

function showUploadModal(state, files, errorMessage = '', product = null) {
  const saved = state === 'saved'
  const failed = state === 'failed'
  els.uploadModal.classList.remove('hidden')
  els.uploadModal.innerHTML = `
    <section class="upload-panel">
      <button type="button" class="icon-button close-button" data-upload-close aria-label="Close">x</button>
      <div class="upload-icon ${saved ? 'saved' : failed ? 'failed' : ''}">${saved ? 'OK' : failed ? '!' : '^'}</div>
      <h2>${saved ? 'Product Saved' : failed ? 'Upload Failed' : 'Saving Product'}</h2>
      <p>${escapeHtml(errorMessage || (saved ? 'All files uploaded and your product has been saved.' : 'Uploading to Google Drive. Keep this page open.'))}</p>
      <div class="progress-block">
        <div class="progress-header"><strong>Overall Progress</strong><span>${saved ? '100%' : failed ? 'Stopped' : 'Working'}</span></div>
        <div class="progress-track"><span style="width: ${saved ? 100 : failed ? 72 : 45}%"></span></div>
        <span class="muted-status">${saved ? files.length + 1 : files.length} files ${saved ? 'uploaded' : 'prepared'}</span>
      </div>
      <div class="upload-list">
        ${files
          .map(
            (item) => `
              <div class="upload-row">
                <span class="file-kind">${escapeHtml(item.badge)}</span>
                <div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.file.name)}</span></div>
                <span class="status-mini ${saved ? 'uploaded' : failed ? 'failed' : ''}">${saved ? 'Uploaded' : failed ? 'Pending' : 'Uploading'}</span>
              </div>
            `,
          )
          .join('')}
        <div class="upload-row">
          <span class="file-kind">M</span>
          <div><strong>Master Card</strong><span>${escapeHtml(draft.details.sku || productValue(product || {}, 'sku') || 'SKU')}_Master_Card.pdf</span></div>
          <span class="status-mini ${saved ? 'uploaded' : failed ? 'failed' : ''}">${saved ? 'Uploaded' : failed ? 'Pending' : 'Creating'}</span>
        </div>
      </div>
      <div class="upload-actions">
        ${
          saved
            ? '<button type="button" class="primary-button" data-add-next>Add Next Product</button><button type="button" class="secondary-button" data-go-catalogue>Go To Catalogue</button>'
            : failed
              ? '<button type="button" class="secondary-button" data-upload-close>Close</button>'
              : ''
        }
      </div>
    </section>
  `
  els.uploadModal.querySelectorAll('[data-upload-close]').forEach((button) => button.addEventListener('click', () => els.uploadModal.classList.add('hidden')))
  els.uploadModal.querySelector('[data-add-next]')?.addEventListener('click', () => {
    els.uploadModal.classList.add('hidden')
    draft = freshDraft()
    setScreen('add')
  })
  els.uploadModal.querySelector('[data-go-catalogue]')?.addEventListener('click', () => {
    els.uploadModal.classList.add('hidden')
    setScreen('search')
  })
}

function renderProducts() {
  els.filtersPanel.classList.toggle('hidden', !showFilters)
  const visible = filteredProducts()
  els.productCount.textContent = `${visible.length} Products Found`
  els.clearSelection.classList.toggle('hidden', selectedIds.size === 0)
  els.productGrid.replaceChildren()

  if (!visible.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state catalogue-empty'
    empty.innerHTML = '<strong>No products found</strong><span>Adjust filters or add a new gemstone.</span>'
    els.productGrid.append(empty)
  } else {
    visible.forEach((product) => els.productGrid.append(productCard(product)))
  }

  renderSelectionBar()
}

function filteredProducts() {
  return products.filter((product) => {
    const details = productDetails(product)
    const haystack = DETAIL_KEYS.map((key) => details[key] || '').join(' ').toLowerCase()
    if (filters.query && !haystack.includes(filters.query.toLowerCase())) return false
    if (filters.gemstone && !details.gemstone.toLowerCase().includes(filters.gemstone.toLowerCase())) return false
    if (filters.origin && !details.origin.toLowerCase().includes(filters.origin.toLowerCase())) return false
    if (filters.shape && !details.shape.toLowerCase().includes(filters.shape.toLowerCase())) return false
    if (filters.treatment && !details.treatment.toLowerCase().includes(filters.treatment.toLowerCase())) return false
    if (filters.lab && !details.laboratory.toLowerCase().includes(filters.lab.toLowerCase())) return false
    const weight = toNumber(details.weightCt)
    const price = toNumber(details.pricePerCarat)
    if (filters.minWeight && weight < toNumber(filters.minWeight)) return false
    if (filters.maxWeight && weight > toNumber(filters.maxWeight)) return false
    if (filters.minPrice && price < toNumber(filters.minPrice)) return false
    if (filters.maxPrice && price > toNumber(filters.maxPrice)) return false
    return true
  })
}

function productCard(product) {
  const details = productDetails(product)
  const card = document.createElement('article')
  card.className = selectedIds.has(product.id) ? 'product-card selected' : 'product-card'
  card.dataset.productCard = product.id
  const image = imageForProduct(product)
  card.innerHTML = `
    <button type="button" class="${selectedIds.has(product.id) ? 'select-circle selected' : 'select-circle'}" data-select-product="${escapeAttr(product.id)}" aria-label="Select ${escapeAttr(details.sku)}">${selectedIds.has(product.id) ? 'OK' : ''}</button>
    <div class="card-media">${image ? `<img src="${escapeAttr(image)}" alt="">` : gemPlaceholder(details.gemstone)}</div>
    <div class="card-info">
      <strong>${escapeHtml(details.sku || 'SKU')}</strong>
      <span>${escapeHtml(details.gemstone || 'Gemstone')}</span>
      <b>${escapeHtml(details.weightCt || '-')} ct</b>
      <small>${details.pricePerCarat ? `${escapeHtml(currency(toNumber(details.pricePerCarat)))} / ct` : 'Price pending'}</small>
    </div>
  `
  card.addEventListener('click', (event) => {
    const select = event.target.closest('[data-select-product]')
    if (select) {
      event.stopPropagation()
      toggleSelected(product.id)
      return
    }
    openProductDetail(product.id)
  })
  const imageNode = card.querySelector('img')
  imageNode?.addEventListener('error', () => {
    const media = card.querySelector('.card-media')
    if (media) media.innerHTML = gemPlaceholder(details.gemstone)
  })
  return card
}

function toggleSelected(id) {
  if (selectedIds.has(id)) selectedIds.delete(id)
  else selectedIds.add(id)
  renderProducts()
}

function renderSelectionBar() {
  const selected = products.filter((product) => selectedIds.has(product.id))
  els.selectionBar.classList.toggle('hidden', !selected.length)
  els.selectionCount.textContent = `${selected.length} Products Selected`
  els.selectionWeight.textContent = `Total Weight: ${selected.reduce((sum, product) => sum + toNumber(productValue(product, 'weightCt')), 0).toFixed(2)} ct`
}

function openProductDetail(productId) {
  const product = products.find((item) => item.id === productId)
  if (!product) return
  const details = productDetails(product)
  const image = imageForProduct(product)
  const heroVideo = productMedia(product).find((item) => item.role === 'heroVideo') || productMedia(product).find((item) => item.kind === 'video')
  els.productDetailModal.classList.remove('hidden')
  els.productDetailModal.innerHTML = `
    <section class="detail-panel">
      <button type="button" class="icon-button close-button" data-close-detail aria-label="Close">x</button>
      <div class="detail-media">
        ${image ? `<img src="${escapeAttr(image)}" alt="">` : gemPlaceholder(details.gemstone)}
        ${heroVideo ? '<span class="video-chip">Main video ready</span>' : ''}
      </div>
      <div class="detail-content">
        <span class="product-status">${escapeHtml(product.status || 'saved')}</span>
        <h2>${escapeHtml([details.sku, details.gemstone, details.variety].filter(Boolean).join(' - ') || 'Product')}</h2>
        <dl class="detail-list">
          ${infoRow('Weight', details.weightCt ? `${details.weightCt} ct` : '')}
          ${infoRow('Price / ct', details.pricePerCarat ? currency(toNumber(details.pricePerCarat)) : '')}
          ${infoRow('Total', currency(totalPrice(details)))}
          ${infoRow('Category', details.category)}
          ${infoRow('Origin', details.origin)}
          ${infoRow('Shape / Cut', [details.shape, details.cut].filter(Boolean).join(' / '))}
          ${infoRow('Treatment', details.treatment)}
          ${infoRow('Certification', [details.laboratory || 'Non-Certified', isCertifiedDetails(details) ? details.certificateNo : ''].filter(Boolean).join(' '))}
        </dl>
        <div class="share-actions">
          <button type="button" class="primary-button" data-share-package="main">Send main video + master card</button>
          <button type="button" class="secondary-button" data-share-package="allMedia">All pictures/videos + master card</button>
          <button type="button" class="secondary-button" data-share-package="allWithCertificate">All pictures/videos + master card + certificate</button>
        </div>
        <div class="detail-footer-actions">
          ${product.driveFolders?.skuFolderId ? `<a class="text-button" href="https://drive.google.com/drive/folders/${escapeAttr(product.driveFolders.skuFolderId)}" target="_blank" rel="noreferrer">Open Drive Folder</a>` : ''}
        </div>
      </div>
    </section>
  `
  els.productDetailModal.querySelector('[data-close-detail]').addEventListener('click', closeProductDetail)
  els.productDetailModal.querySelectorAll('[data-share-package]').forEach((button) => {
    button.addEventListener('click', () => shareProduct(product.id, button.dataset.sharePackage))
  })
}

function closeProductDetail() {
  els.productDetailModal.classList.add('hidden')
  els.productDetailModal.replaceChildren()
}

async function shareProduct(productId, packageName) {
  const result = await api(`/api/products/${productId}/share/${packageName}`)
  window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer')
}

function shareSelectedProducts() {
  const selected = products.filter((product) => selectedIds.has(product.id))
  if (!selected.length) return
  const lines = selected.flatMap((product) => {
    const details = productDetails(product)
    return [
      `${details.sku} - ${details.gemstone}`,
      details.weightCt ? `Weight: ${details.weightCt} ct` : '',
      details.pricePerCarat ? `Price / ct: ${details.pricePerCarat}` : '',
      product.masterCard?.driveWebViewLink ? `Master card: ${product.masterCard.driveWebViewLink}` : '',
      '',
    ].filter((line) => line !== '')
  })
  window.open(`https://wa.me/?text=${encodeURIComponent([appConfig.businessName, ...lines].join('\n'))}`, '_blank', 'noopener,noreferrer')
}

async function api(url, options = {}) {
  const headers = options.headers || { 'Content-Type': 'application/json' }
  if (csrfToken && options.method && options.method !== 'GET') headers['x-csrf-token'] = csrfToken
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

function productDetails(product) {
  const details = product.details
    ? { ...EMPTY_DETAILS, ...product.details }
    : {
    ...EMPTY_DETAILS,
    ...Object.fromEntries(DETAIL_KEYS.map((key) => [key, product[key] || ''])),
  }
  if (!details.category) details.category = 'Astrological'
  if (!details.laboratory) details.laboratory = 'Non-Certified'
  if (!isCertifiedDetails(details)) details.certificateNo = ''
  return details
}

function productValue(product, key) {
  return productDetails(product)[key] || ''
}

function productMedia(product) {
  return Array.isArray(product.media) ? product.media : []
}

function imageForProduct(product) {
  const media = productMedia(product)
  const hero = media.find((item) => item.role === 'heroImage') || media.find((item) => item.kind === 'photo')
  if (hero?.driveFileId) return `/api/drive/files/${encodeURIComponent(hero.driveFileId)}/content`
  return hero?.thumbnailLink || hero?.driveWebContentLink || ''
}

function countPhotos() {
  return (draft.files.heroPhoto ? 1 : 0) + draft.files.photos.length
}

function isCertifiedDetails(details) {
  const lab = String(details.laboratory || '').trim().toLowerCase()
  return Boolean(lab && lab !== 'non-certified')
}

function driveFolderPath(details) {
  return [
    appConfig.driveRootFolderName,
    details.category || 'Astrological',
    details.gemstone || 'Gemstone',
    details.origin || 'Origin',
    weightRangeLabel(details.weightCt),
    details.sku || 'SKU',
  ].join(' / ')
}

function weightRangeLabel(value) {
  const weight = toNumber(value)
  if (!weight || weight < 0) return 'Unsorted Weight'
  const from = Math.floor(weight)
  return `${from}-${from + 1} cts`
}

function mergeProduct(currentProducts, product) {
  return [product, ...currentProducts.filter((item) => item.id !== product.id)].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

function suggestSku(gemstone) {
  const known = {
    'Yellow Sapphire': 'YS',
    'Blue Sapphire': 'BS',
    Emerald: 'EM',
    Ruby: 'RB',
    'Pink Sapphire': 'PS',
    'White Sapphire': 'WS',
  }
  const prefix =
    known[gemstone] ||
    gemstone
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toUpperCase() ||
    'GM'
  const count = products.filter((product) => productValue(product, 'sku').startsWith(prefix)).length + 1
  return `${prefix}-${String(count).padStart(3, '0')}`
}

function normalizeSku(value) {
  return String(value || '').trim().replace(/\s+/g, '-').toUpperCase()
}

function objectUrlFor(file) {
  if (!objectUrls.has(file)) objectUrls.set(file, URL.createObjectURL(file))
  return objectUrls.get(file)
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  return Number(String(value || '').replace(/[^\d.-]/g, '')) || 0
}

function totalPrice(details) {
  return toNumber(details.weightCt) * toNumber(details.pricePerCarat)
}

function currency(value) {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: appConfig.currency || 'INR',
      maximumFractionDigits: 0,
    }).format(value || 0)
  } catch {
    return `INR ${Math.round(value || 0).toLocaleString('en-IN')}`
  }
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function infoRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '-')}</dd></div>`
}

function gemPlaceholder(gemstone) {
  const initials = String(gemstone || 'JMJ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
  return `<div class="gem-placeholder"><span>${escapeHtml(initials || 'JMJ')}</span></div>`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;')
}
