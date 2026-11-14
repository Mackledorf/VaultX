# Local vault: product notes and implementation plan

Status: **experimental prototype**. The app can create, select, or reconnect to a vault, create parent folders, browse and import individual media files, edit keywords, copy items, and move items between parents. Moves use a verified copy and an interruption record, but are not transactional. Standalone keyword creation, deletion, batch imports, drag-and-drop, and guided recovery are not implemented. Windows browser testing is still required. Onboard is a separate media-formatting product and is not part of this vault workflow.

## Purpose and principles

VaultX should be a simple, private way to browse personal images, GIFs, and videos held in a folder the user owns on their own drive, much like an Obsidian vault. The folder and media remain useful outside VaultX. VaultX should not require an account, its own server, cloud storage, or a repeated vault download to make edits. A minimal, deliberately plain interface should put the library and basic controls ahead of decoration.

## Intended user flow

1. On opening VaultX, choose a local folder as a vault, or name a new vault and select a location in which its folder is created. Drag-and-drop remains a planned convenience where supported.
2. Recognize an existing vault using a versioned marker file. If the marker is missing, do not silently alter the folder: offer to initialize the selected folder after explaining what will be created. Preserve existing files and folders. Reject or open read-only if the marker is invalid or from an unsupported version; never overwrite it.
3. Read the vault's immediate subfolders as parent tags. Display supported media in those folders and load their keywords from a readable metadata file. Existing folders become available as parent filters without a separate setup step. Files added outside VaultX should be visible after a refresh, even if they have no keywords.
4. Browse all media or filter by media type, parent tag, and keywords. Creating a parent in the filter makes a folder, including when it is empty. Keywords can be added when importing or editing an item; creating an unused keyword from the filter is planned.
5. To add media through VaultX, choose a file, choose a required parent tag, and optionally enter keywords. The file is copied into the parent folder and indexed in the vault metadata. Batch selection and per-file progress remain planned; an item is not reported as saved until both writes complete.
6. Open an item to view it, edit its keywords, copy it, or explicitly move it to another parent. A move creates and verifies a uniquely named copy, saves its keywords, then removes the original and its metadata. Deletion is not implemented.
7. On a later visit, offer to reconnect to a previously selected vault. The browser may ask for permission again or require the user to select the folder again. A vault can also be opened from another computer by selecting its copied folder; the folder, not browser storage, is the source of truth.

## Proposed on-disk format

Use ordinary folders and a UTF-8 JSON text file at the root, for example:

```text
My Vault/
  vaultx.json
  Landscapes/
    86c8f76c-7c09-499e-b155-3ca60e755a4f.jpg
    lake.png
  Animation/
    loop.gif
```

```json
{
  "format": "vaultx",
  "version": 1,
  "vaultId": "b16a18c9-3d5a-4275-b6d0-fcf83b91af4a",
  "keywords": ["coast", "sunset", "loop"],
  "items": [
    {
      "parent": "Landscapes",
      "file": "86c8f76c-7c09-499e-b155-3ca60e755a4f.jpg",
      "keywords": ["coast", "sunset"]
    },
    {
      "parent": "Animation",
      "file": "loop.gif",
      "keywords": ["loop"]
    }
  ]
}
```

- The marker, version, stable random vault ID, keyword vocabulary, and file-to-keyword key are all in `vaultx.json`. The ID identifies a vault; it is not authentication or encryption. Each item is keyed by its immediate parent folder name and filename. Keywords may be empty; unindexed files are displayed with no keywords until edited.
- A parent is exactly one immediate child directory of the root. Nested directories are not additional parents in the first version; surface them as unsupported rather than silently moving or deleting anything. Root-level media likewise needs an explicit organize/import decision. Keep unrelated files intact and ignore unsupported files.
- Preserve existing filenames. For new imports, a random UUID plus a validated extension is a reasonable default; never overwrite an existing name. Validate names as single path components and handle Windows reserved characters/names, case-insensitive collisions, trailing dots/spaces, and length limits. Reject unsafe paths and reserved metadata names. Do not follow links outside the chosen root.
- The keyword vocabulary retains keywords used in imports and edits, including after an item no longer uses them. Standalone keyword creation is planned. Keywords are deduplicated case-insensitively while preserving display spelling; search terms must each match part of at least one keyword, in addition to the selected parent and media type.
- External renames, moves, or deletions can break a filename mapping. On refresh, report missing indexed files and newly discovered files; offer explicit repair/relink or removal of stale metadata, without automatically deleting files or transferring keywords to a guessed match. Validate malformed metadata and keep it untouched, with a clear recovery path.
- The initial browser implementation writes this version 1 marker when explicitly initialized. The format is still experimental, not a finalized compatibility contract; specify migrations and backups before changing it.
- Initialization checks for an existing marker before writing, but browser APIs do not offer exclusive creation: another process could race that check. Avoid initializing a folder while another app or tab is changing it. If initialization fails, inspect the marker before retrying; an incomplete marker may require manual recovery.

## Windows and browser approach

Use a client-side web app with the File System Access API in a supported desktop browser, initially current Chromium-based Edge and Chrome on Windows. The current picker requests read access; initialization separately requests read/write permission. The API returns a directory handle that can be enumerated, and a writable handle can save changes directly to the user's files. Feature-detect the APIs, require HTTPS (or a suitable local development origin), and clearly explain unsupported browsers, blocked sensitive directories, canceled pickers, and denied or revoked permissions. A normal folder upload or `webkitdirectory` input supplies file snapshots, not a persistent writable vault.

The optional drop target can use `DataTransferItem.getAsFileSystemHandle()` where supported. Obtain handle promises synchronously in the drop event, validate that exactly one directory was dropped, and request write permission when needed. If the browser does not provide a writable directory handle or permission, direct the user to the picker; do not pretend a read-only upload can save back.

Store the directory handle, not the vault contents, in origin-scoped IndexedDB for reconnection. On return, check permission and request it from a user action when necessary; persistence and permission are browser-dependent, and clearing site data, changing origins, moving the folder, or revocation may require reselection. Never assume a stored handle grants permanent access. Keep the selected folder accessible to the user in Windows Explorer.

This design can run from a static HTTPS site. Media must be processed locally, with no network upload, analytics of media content, or hidden sync. A hosted site's code still has access to a folder after permission is granted, so secure deployment and dependencies matter; local storage is not encryption or protection against malware or other users of the computer. If broader browser support or stronger native filesystem guarantees become essential, evaluate a local desktop app as a separate decision rather than silently falling back to downloads.

References: [MDN directory picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker), [Chrome file system access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), and [MDN dropped file system handles](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle).

## Reliability and safety

- Serialize writes across tabs of the same origin with Web Locks and check for external changes before replacing metadata. Other browser origins, applications, and cloud-sync clients can still race the checks. Browser file APIs do not provide a cross-file transaction or a universal exclusive-create/atomic-rename guarantee, so avoid promising lossless concurrent writes.
- Imports and copies use unique filenames and preserve the source. Errors identify the destination for inspection; interrupted copies may appear as unindexed media. Moves create a persistent record, verify file contents in chunks, and update destination metadata before attempting source removal. An interruption can leave both copies, a missing metadata entry, or a stale source entry; inspect the record and files. Automatic recovery is not implemented.
- Before updating metadata, save a uniquely named backup in the vault and check that the marker has not changed. Remove the backup after success; surface remaining backups for inspection. Validate data before writing, and do not silently replace malformed or externally modified data with an empty index. A guided restore is not yet implemented. Ask users to back up the entire vault, including its metadata, and test restoring it.
- Media is rendered locally using object URLs, which are revoked when no longer needed. The grid avoids loading video files for thumbnails, but large-library performance and incremental loading still need work.

## Recovering an interrupted operation

1. Stop other VaultX tabs and programs that might change the vault. Make a separate backup of the entire vault, including hidden files and `vaultx.json`. Do not retry the operation yet.
2. In the vault root, inspect any `.vaultx-operation-*.json` record. Its `source` and `destination` identify the two paths and its `keywords` identify the intended keywords. Check which files exist and compare their contents. An interruption may leave either or both copies, and a failed write may leave an incomplete destination. Preserve any file you are unsure about.
3. Inspect `vaultx.json` and any `.vaultx-backup-*.json` files in a text editor. Decide which files and metadata entries are correct; a backup is an earlier version, so blindly restoring it can discard later changes. If needed, restore from your full vault backup or carefully repair the item entries using the recorded paths and keywords. Keep JSON valid and do not change the vault ID.
4. Only after resolving the files and metadata, move the leftover operation records and metadata backups **out of the vault** into your separate backup. Reopen or refresh the vault and check for missing or unindexed items before making further changes. VaultX blocks writes while these recovery files remain in the root.

## Windows test checklist

After these changes are pushed, install Node.js 22.12 or newer on Windows, clone this repository, run `npm ci` and `npm run dev`, and open Vite's localhost URL in current Chrome or Edge. Use a disposable folder and copied sample media, with a separate backup. No VaultX hosting is provided by the repository's existing Onboard Pages workflow.

1. Create a named vault, then create two parent folders. Confirm the folders and `vaultx.json` in Explorer.
2. Import supported images and videos with and without keywords. Filter by parent, media type, and keywords; edit keywords on imported and pre-existing unindexed files.
3. Copy and move an item to another parent. Confirm the copy retains the original, the move removes it only from the source, and keywords follow the new filename in `vaultx.json`.
4. Close and reopen or reconnect, refresh after external changes, and test denied or renewed permissions. Check missing/unindexed warnings and verify no vault download is needed.
5. Test interruption and recovery only with disposable data. Verify the warnings and recovery procedure, and restore the separate backup if unsure.

The automated tests use simulated handles; they do not prove actual Windows permission, sync-client, or filesystem behavior.

## Implementation sequence and acceptance checks

1. **Prototype access on Windows:** test picker, drop, directory enumeration, writes, handle restoration, permission prompts, and revocation in current Edge and Chrome. Decide and document the support matrix; feature-detect instead of relying on browser names.
2. **Implement and test the vault format:** validate markers and versions; initialize only after confirmation; scan parent folders and reconcile unindexed/missing media. Implement safe names, vocabulary, conflict detection, backups, and recoverable writes before exposing destructive operations.
3. **Implement local storage operations:** build on the browser-local vault adapter and do not send local media over the network.
4. **Build the local flow:** connect/create/reconnect, browse, parent and keyword create/filter, imports, details, edits, and confirmed deletion, with clear permission, empty, unsupported, conflict, and recovery states. Keep the plain responsive UI and keyboard access.
5. **Verify end to end on Windows:** initialize and reopen a real folder, create empty parents and unused keywords, import duplicate-named files with and without keywords, filter and edit, inspect files and metadata in Explorer, then reload and reconnect without downloading a vault. Test pre-existing folders/files, external additions/renames/deletions, unsupported versions, malformed metadata, revoked permissions, storage failures, interrupted imports, concurrent changes, and backups/restores. Confirm no media leaves the browser.
