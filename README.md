# JMJ OS Digital Catalogue

Private secure website catalogue for Jay Mataji Jewels.

## What It Does

- Adds one gemstone product as one SKU.
- Stores photos, videos, certificates, notes, and a generated master card.
- Extracts certificate text from PDF certificates and OCRs image certificates.
- Creates this Google Drive structure:

```text
JMJ Digital Catalogue
├── Yellow Sapphire
│   ├── YS-001
│   │   ├── Photos
│   │   ├── Videos
│   │   ├── Certificate
│   │   └── Information Card
│   └── YS-002
├── Blue Sapphire
├── Emerald
└── Ruby
```

- Updates `catalogue_index.json` and `price_sheet.csv` in the Drive root folder.
- Provides searchable catalogue cards with filters for gemstone, origin, shape, treatment, lab, weight, and price.
- Shares customer packages through WhatsApp:
  - Main video + master card
  - All photos/videos + master card
  - All photos/videos + master card + certificate

## Run Locally

```bash
npm install
cp .env.example .env
npm run website:dev
```

Open:

```text
http://localhost:8787
```

## Google Drive Setup

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Create an OAuth Client ID of type `Web application`.
4. Add this Authorized JavaScript origin:

```text
http://localhost:8787
```

5. Add this Authorized redirect URI:

```text
http://localhost:8787/api/google/callback
```

6. Set these in `.env`, or save them inside the website under `Settings`:

```text
GOOGLE_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-web-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8787/api/google/callback
```

Google Drive OAuth credentials are configured on the server in `.env`. The Settings screen only provides the **Connect Drive** and **Sync Catalogue** actions.

For production login, create a Firebase project, enable Authentication email/password, add your user, then set `FIREBASE_API_KEY` and `FIREBASE_ALLOWED_EMAILS` in `.env`. The local admin password hash is only a fallback for development/private testing.

For production, set strong `SESSION_SECRET` and `APP_ENCRYPTION_KEY` values, use Firebase login, and set the Google OAuth values as environment variables on your hosting provider.

## Storage

The deployed web server is stateless. It does not need `.data/store.json`, `.data/website/store.json`, or Firestore.

Google Drive is the master file store once connected. Product media, certificate files, generated master cards, `catalogue_index.json`, and `price_sheet.csv` are saved inside the configured Drive root folder.

Login/session state, Google Drive tokens, and optional Settings overrides are kept in encrypted HttpOnly browser cookies, not in server files.
