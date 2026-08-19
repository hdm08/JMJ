import { FirestoreStore, JsonStore } from './store.js'

const jsonStore = new JsonStore()
const firestoreStore = new FirestoreStore()

await jsonStore.init()
await firestoreStore.init()

const data = await jsonStore.read()
const products = data.products || []
await firestoreStore.replaceProducts(products)

if (data.googleTokens) await firestoreStore.setGoogleTokens(data.googleTokens)
if (data.googleOAuthConfig) await firestoreStore.setGoogleOAuthConfig(data.googleOAuthConfig)
if (data.websiteSettings) await firestoreStore.saveWebsiteSettings(data.websiteSettings)

console.log(
  JSON.stringify(
    {
      migrated: true,
      products: products.length,
      googleTokens: Boolean(data.googleTokens),
      googleOAuthConfig: Boolean(data.googleOAuthConfig),
      websiteSettings: Boolean(data.websiteSettings && Object.keys(data.websiteSettings).length),
      sessionsSkipped: data.sessions?.length || 0,
    },
    null,
    2,
  ),
)
