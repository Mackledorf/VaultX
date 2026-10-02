# VaultX

Private Vault.

## Run

```bash
npm install
npm run hash-password -- "choose a master password"
npm run dev
```

Create a `.env` file from `.env.example` before starting the app.

## Configuration

VaultX now uses a private API instead of Supabase. The browser only receives a session cookie; the master password hash and storage credentials stay on the server.

Required values:

- `SESSION_SECRET`: long random string used to sign sessions.
- `VAULT_PASSWORD_HASH`: output from `npm run hash-password -- "your password"`.
- `VAULT_STORAGE_PROVIDER`: `google-drive` for the online vault or `local` for development.
- `GOOGLE_DRIVE_FOLDER_ID`: private Drive folder used for media and `vaultx-manifest.json`.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: service account JSON shared into the Drive folder.

For local-only development, set `VAULT_STORAGE_PROVIDER=local` and `LOCAL_STORAGE_DIR=.vaultx-data`.

## Storage Model

Collections replace tags. Each upload is assigned to one collection, and the API writes media metadata into one shared `vaultx-manifest.json`. Media is served through authenticated `/api/media/:id` routes with Range support for videos.
