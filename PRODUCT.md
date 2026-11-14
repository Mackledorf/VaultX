# VaultX Product Brief

VaultX is a private, local media library for personal photos, GIFs, and videos. It is a browser interface for a user-owned folder on the user's drive, organized by parent folders and searchable keywords. It does not require an account or media server.

## Available now

- Choose or explicitly initialize a folder, browse supported media in immediate subfolders, and search existing keyword metadata.
- Reconnect to a remembered folder when browser permissions allow, or choose it again.
- Refresh the view after changes made outside the app.
- Create a named vault and parent folders, import one file with optional keywords, edit keywords, copy an existing item, or move it to another parent.
- Detect leftover move records and metadata backups and block further writes until they are manually resolved.

## Still to implement

- Create standalone keywords, batch import, and delete media with confirmation.
- Support folder drag-and-drop, guided recovery, and stronger external conflict handling.
- Verify real filesystem and permission behavior in supported Windows browsers.

The vault is not encrypted by the app. Browser access is granted by the user and may require renewed permission. See [LOCAL-VAULT.md](LOCAL-VAULT.md) for the proposed workflow, storage format, and implementation plan.
