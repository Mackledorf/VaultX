# VaultX

VaultX is a browser interface for a media vault stored in a folder on your own device. See [PRODUCT.md](PRODUCT.md) for the product scope and [LOCAL-VAULT.md](LOCAL-VAULT.md) for the planned workflow.

## Current functionality

Use a supported desktop browser such as Chrome or Edge over HTTPS or localhost. Choose an existing folder or select **New vault**, enter a name, and choose where its folder should be created. If an existing folder is not already a vault, explicitly initialize it to create `vaultx.json`. The app reads media from immediate child folders as parent tags and searches existing keyword metadata. Select **Refresh** to pick up external changes. Close the vault to return to folder selection.

With a vault open, use **Add media** or drop files or folders onto the page. Select a parent and optional keywords for each supported file, then choose **Import media**. Folder imports include nested files; each is copied into its selected parent, not the source folder hierarchy. Unsupported or unreadable entries are reported. New parent tags in the batch are created when importing; new keyword tags are saved immediately, even if the batch is canceled.

Type to find or create parent and keyword tags. The keyword filter shows media containing all selected tags. Open an item to edit its keywords, copy it to another parent, or move it. Copy retains the original; move verifies a new copy before removing the source. Imported, copied, and moved files receive unique filenames. Existing unindexed media can be assigned keywords.

This is an experimental prototype: deletion and automatic recovery are not implemented. Root-level media and nested folders already inside a vault are reported but not scanned. Real Windows browser behavior has not yet been verified.

## Folder access and privacy

VaultX uses the browser's File System Access API. You select a folder and grant access; the browser can then read it, and can write to it when you explicitly grant write permission. Some sensitive folders may be blocked. Permission can be revoked or requested again. The browser may remember a folder handle for reconnection, but this is not guaranteed; if it cannot, select the folder again.

Media is processed locally, not uploaded. The vault is not encrypted by VaultX. Back up the entire vault, including `vaultx.json`, and protect the computer and backups separately. A hosted site's code can access the folder you authorize, so the site and its dependencies must be trusted.

Writes are coordinated between tabs of the same origin. Avoid editing the vault simultaneously in other applications, browser origins, or sync clients: browser filesystem operations are not cross-file transactions and cannot eliminate external races. **Back up the vault before testing.** A batch continues after ordinary item failures, but pauses if metadata or permission needs attention. Inspect incomplete copies before retrying; uncertain items are not retried automatically. An interrupted write can leave a copy, a `.vaultx-operation-*.json` move record, or a `.vaultx-backup-*.json` metadata backup. VaultX blocks further writes until recovery files are resolved. See [recovery instructions](LOCAL-VAULT.md#recovering-an-interrupted-operation).

## Local development and deployment

Use Node.js 22.12 or newer (the CI workflow uses Node 22):

```bash
npm ci
npm run dev
```

For a Windows test after the changes are pushed, clone the repository, run the commands above in PowerShell, and open the localhost URL printed by Vite in current Chrome or Edge. Test with a disposable vault and copies of sample files, not irreplaceable originals. Grant folder read/write access when prompted; inspect the folder and `vaultx.json` in Explorer after importing, editing keywords, moving, refreshing, and reopening. See the [Windows test checklist](LOCAL-VAULT.md#windows-test-checklist).

The application is a static frontend; it needs no media server, account, password, or server configuration. It can be served over HTTPS as static files. The GitHub Pages workflow builds both apps into one site: VaultX is published at the repository root, and Onboard is published under `/Onboard/`.

Open [VaultX](https://mackledorf.github.io/VaultX/) or [Onboard](https://mackledorf.github.io/VaultX/Onboard/) after the combined Pages deployment completes. Onboard remains a separate browser-based MP4-to-GIF editor with its own app, dependencies, and assets; see the standalone [Onboard project](./onboard/) and [Onboard README](./onboard/README.md).

## Tests and build

```bash
npm test
npm run build
```

The local-vault tests use simulated directory handles; they do not replace testing actual permissions and filesystem behavior in Windows browsers.
