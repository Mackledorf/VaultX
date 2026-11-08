# VaultX Product Brief

VaultX is a single-user, private media library for personal photos, GIFs, and videos. The app runs on an always-on Node server and stores original files on that server's private disk, outside the source repository and static web root. The browser receives media only through authenticated same-origin API routes over HTTPS.

## V1

- Search library media by user-applied tags only. Original upload filenames are discarded and never stored as metadata.
- Filter results by all media, still images, GIFs, or videos.
- Upload multiple supported files with per-file progress, shared tags, and validation feedback.
- Review a media item, edit its tags, or permanently delete it.
- Keep metadata in SQLite and originals/previews in private directories on the app host.
- Generate small private image/GIF previews; show a lightweight video tile and load the original only when opened.

## Privacy and operation

- One password-protected account; no registration, public sharing, or public media URLs.
- Serve the app over HTTPS behind a reverse proxy or access gateway. The Node process listens on loopback by default.
- Keep the configured data directory outside the repository, build output, and static web root. Git ignore is a secondary safeguard, not the privacy boundary.
- Back up the SQLite database and media/previews together. Protect backups with encryption and test restores.
- No Supabase, Google Drive storage, cloud sync, or migration of legacy collections in v1.
