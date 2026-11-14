# VaultX Product Brief

VaultX is a private, local media library for personal photos, GIFs, and videos. It is a browser interface for a user-owned folder on the user's drive, organized by parent folders and searchable keywords. It does not require an account or media server.

## Available now

- Choose or explicitly initialize a folder, browse supported media in immediate subfolders, and search existing keyword metadata.
- Reconnect to a remembered folder when browser permissions allow, or choose it again.
- Refresh the view after changes made outside the app.
- Create a named vault and parent folders, import selected or dropped files and folders in batches, edit keywords, copy an existing item, or move it to another parent.
- Use searchable parent and keyword tags, create keywords independently of media, and filter by all selected keyword tags.
- Detect leftover move records and metadata backups and block further writes until they are manually resolved.

## Still to implement

- Delete media with confirmation.
- Support guided recovery and stronger external conflict handling.
- Verify real filesystem and permission behavior in supported Windows browsers.

The vault is not encrypted by the app. Browser access is granted by the user and may require renewed permission. See [LOCAL-VAULT.md](LOCAL-VAULT.md) for the proposed workflow, storage format, and implementation plan.
