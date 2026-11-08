# VaultX

VaultX is a single-user, private media library. Search by tags, filter images/GIFs/videos, upload media, edit tags, and remove entries. See [PRODUCT.md](PRODUCT.md) for the intended product scope.

Onboard is a separate browser-based MP4-to-GIF editor with its own app, dependencies, assets, build, and deployment workflow. It does not use VaultX's API or storage. After its first GitHub Pages deployment, [open Onboard](https://mackledorf.github.io/VaultX/) directly without opening or running VaultX, or see the standalone [Onboard project](./onboard/) and [Onboard README](./onboard/README.md).

## Local development

```bash
npm ci
cp .env.example .env
npm run hash-password -- "choose a strong vault password"
npm run dev
```

Put the password hash printed by the command into `.env` as `VAULT_PASSWORD_HASH`. Generate a session secret with `openssl rand -base64 48`. The API binds to `127.0.0.1`; the Vite development server proxies API requests to it.

For a password-free local demo only, set `VAULT_AUTH_DISABLED=true` in `.env`. This bypass is honored only outside production when `HOST` is explicitly a loopback host (`127.0.0.1`, `::1`, or `localhost`); it is ignored in production and on network-bound hosts. Do not enable it for a shared or deployed server.

## Deployment

VaultX needs an always-on Node.js host with persistent disk. GitHub Pages is not a supported deployment target: it serves static files and cannot run the private API or access the server's media directory. Put a TLS reverse proxy or an access gateway in front of the app, and keep the Node API bound to loopback. Use `NODE_ENV=production` so session cookies are marked Secure. Add MFA at the gateway for an internet-reachable deployment.

Set these server-side environment variables:

- `SESSION_SECRET`: random secret of at least 32 characters.
- `VAULT_PASSWORD_HASH`: output from `npm run hash-password -- "your password"`.
- `VAULT_STORAGE_PROVIDER=local`: the only supported storage provider.
- `LOCAL_STORAGE_DIR`: absolute persistent data path outside the checkout and web root. The default is `~/.vaultx-data`.
- `MAX_FILE_SIZE_BYTES`: per-file upload limit; defaults to 150 MiB.
- `HOST=127.0.0.1`: keep the app private behind the TLS proxy.

The process creates `media/`, `previews/`, and `.staging/` under the data directory with restrictive permissions. Original uploads receive random opaque names; original filenames are not stored. Metadata and tags live in `vaultx.sqlite`. Media and previews are returned only by authenticated API routes. GIF previews are still WebP frames; videos use a lightweight type tile and load only when opened.

## Privacy and backups

`.gitignore` excludes common local data paths as defense in depth, but it does not make files private, remove already-tracked files, or protect a deployed server. Keep the data directory outside the repo and static root, restrict host access, use encrypted disks where available, and secure backups separately.

For a simple consistent backup, stop VaultX, copy the entire configured data directory to encrypted backup storage, then restart it. This includes the SQLite database, originals, and derived previews. Restore the directory as a unit while VaultX is stopped, preserve file permissions, and verify the library before deleting the backup. Do not commit the data directory or upload it as a build artifact.

## Tests and build

```bash
npm test
npm run build
```

The server integration tests use an isolated temporary data directory. They cover anonymous access denial, authenticated upload, tag/type search, private previews, media reads, video byte ranges, tag edits, and deletion. Existing legacy JSON manifest data is not migrated or automatically deleted.
