import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Firestore } from '@google-cloud/firestore'
import { config } from './config.js'

const initialData = {
  products: [],
  sessions: [],
  googleTokens: null,
  googleOAuthConfig: null,
  oauthStates: [],
  websiteSettings: {},
}

export class JsonStore {
  constructor(filePath = path.join(config.dataDir, 'store.json')) {
    this.filePath = filePath
    this.writeQueue = Promise.resolve()
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await this.read()
  }

  async read() {
    try {
      const text = await readFile(this.filePath, 'utf8')
      return { ...initialData, ...JSON.parse(text) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await this.write(initialData)
      return { ...initialData }
    }
  }

  async write(data) {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      await writeFile(tmpPath, JSON.stringify(data, null, 2))
      await rename(tmpPath, this.filePath)
    })
    return this.writeQueue
  }

  async listProducts() {
    const data = await this.read()
    return data.products.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async saveProduct(product) {
    const data = await this.read()
    data.products = [product, ...data.products.filter((item) => item.id !== product.id)]
    await this.write(data)
    return product
  }

  async replaceProducts(products) {
    const data = await this.read()
    data.products = products
    await this.write(data)
    return products
  }

  async getProduct(id) {
    const data = await this.read()
    return data.products.find((product) => product.id === id) || null
  }

  async saveSession(session) {
    const data = await this.read()
    const now = Date.now()
    data.sessions = [session, ...data.sessions.filter((item) => item.hash !== session.hash && Date.parse(item.expiresAt) > now)]
    await this.write(data)
  }

  async getSession(hash) {
    const data = await this.read()
    return data.sessions.find((session) => session.hash === hash) || null
  }

  async deleteSession(hash) {
    const data = await this.read()
    data.sessions = data.sessions.filter((session) => session.hash !== hash)
    await this.write(data)
  }

  async setGoogleTokens(tokens) {
    const data = await this.read()
    data.googleTokens = tokens
    await this.write(data)
  }

  async getGoogleTokens() {
    const data = await this.read()
    return data.googleTokens
  }

  async setGoogleOAuthConfig(config) {
    const data = await this.read()
    data.googleOAuthConfig = config
    await this.write(data)
  }

  async getGoogleOAuthConfig() {
    const data = await this.read()
    return data.googleOAuthConfig
  }

  async saveWebsiteSettings(settings) {
    const data = await this.read()
    data.websiteSettings = { ...(data.websiteSettings || {}), ...settings }
    await this.write(data)
    return data.websiteSettings
  }

  async getWebsiteSettings() {
    const data = await this.read()
    return data.websiteSettings || {}
  }

  async saveOauthState(state) {
    const data = await this.read()
    const now = Date.now()
    data.oauthStates = [state, ...data.oauthStates.filter((item) => Date.parse(item.expiresAt) > now)]
    await this.write(data)
  }

  async consumeOauthState(value) {
    const data = await this.read()
    const state = data.oauthStates.find((item) => item.value === value)
    data.oauthStates = data.oauthStates.filter((item) => item.value !== value)
    await this.write(data)
    if (!state || Date.parse(state.expiresAt) < Date.now()) return null
    return state
  }
}

export class FirestoreStore {
  constructor() {
    this.db = new Firestore({
      ...(config.firestoreProjectId ? { projectId: config.firestoreProjectId } : {}),
      ...firestoreCredentials(),
      ignoreUndefinedProperties: true,
    })
    this.root = this.db.collection(config.firestoreCollection).doc(config.firestoreDocument)
    this.products = this.root.collection('products')
    this.sessions = this.root.collection('sessions')
    this.meta = this.root.collection('meta')
    this.oauthStates = this.root.collection('oauthStates')
  }

  async init() {
    await this.root.set(
      {
        app: 'jmj-os',
        initializedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }

  async listProducts() {
    const snapshot = await this.products.get()
    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async saveProduct(product) {
    await this.products.doc(product.id).set(product)
    return product
  }

  async replaceProducts(products) {
    const existing = await this.products.get()
    const writes = [
      ...existing.docs.map((doc) => ({ type: 'delete', ref: doc.ref })),
      ...products.map((product) => ({ type: 'set', ref: this.products.doc(product.id), data: product })),
    ]
    await commitFirestoreWrites(this.db, writes)
    return products
  }

  async getProduct(id) {
    const doc = await this.products.doc(id).get()
    return doc.exists ? { id: doc.id, ...doc.data() } : null
  }

  async saveSession(session) {
    await this.sessions.doc(session.hash).set(session)
    await this.deleteExpired(this.sessions, 'expiresAt')
  }

  async getSession(hash) {
    const doc = await this.sessions.doc(hash).get()
    return doc.exists ? doc.data() : null
  }

  async deleteSession(hash) {
    await this.sessions.doc(hash).delete()
  }

  async setGoogleTokens(tokens) {
    await this.setMetaValue('googleTokens', tokens)
  }

  async getGoogleTokens() {
    return this.getMetaValue('googleTokens')
  }

  async setGoogleOAuthConfig(oauthConfig) {
    await this.setMetaValue('googleOAuthConfig', oauthConfig)
  }

  async getGoogleOAuthConfig() {
    return this.getMetaValue('googleOAuthConfig')
  }

  async saveWebsiteSettings(settings) {
    const nextSettings = { ...(await this.getWebsiteSettings()), ...settings }
    const ref = this.meta.doc('websiteSettings')
    await ref.set({ value: nextSettings, updatedAt: new Date().toISOString() })
    return nextSettings
  }

  async getWebsiteSettings() {
    return this.getMetaValue('websiteSettings') || {}
  }

  async saveOauthState(state) {
    await this.oauthStates.doc(state.value).set(state)
    await this.deleteExpired(this.oauthStates, 'expiresAt')
  }

  async consumeOauthState(value) {
    const ref = this.oauthStates.doc(value)
    const doc = await ref.get()
    await ref.delete()
    if (!doc.exists) return null
    const state = doc.data()
    if (!state || Date.parse(state.expiresAt) < Date.now()) return null
    return state
  }

  async setMetaValue(name, value) {
    await this.meta.doc(name).set({
      value,
      updatedAt: new Date().toISOString(),
    })
  }

  async getMetaValue(name) {
    const doc = await this.meta.doc(name).get()
    return doc.exists ? (doc.data()?.value ?? null) : null
  }

  async deleteExpired(collectionRef, fieldName) {
    const snapshot = await collectionRef.where(fieldName, '<=', new Date().toISOString()).get()
    if (snapshot.empty) return
    await commitFirestoreWrites(
      this.db,
      snapshot.docs.map((doc) => ({ type: 'delete', ref: doc.ref })),
    )
  }
}

function firestoreCredentials() {
  if (!config.firestoreServiceAccountJson) return {}

  try {
    const credentials = JSON.parse(config.firestoreServiceAccountJson)
    return {
      projectId: config.firestoreProjectId || credentials.project_id,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    }
  } catch {
    throw new Error('FIRESTORE_SERVICE_ACCOUNT_JSON must be valid Google service account JSON.')
  }
}

export function createStore() {
  if (config.storeDriver === 'firestore') return new FirestoreStore()
  return new JsonStore()
}

async function commitFirestoreWrites(db, writes) {
  for (let index = 0; index < writes.length; index += 450) {
    const batch = db.batch()
    for (const write of writes.slice(index, index + 450)) {
      if (write.type === 'delete') batch.delete(write.ref)
      if (write.type === 'set') batch.set(write.ref, write.data)
    }
    await batch.commit()
  }
}
