# Onboard

Onboard is an independent, browser-based video editor that exports MP4. It is not part of VaultX and does not use VaultX's API, authentication, database, or file storage. Video selection, preview, and MP4 processing happen in the browser; exported MP4s are offered as direct downloads and are not uploaded or saved to a server.

**v0.2 "Working Build"** — after the combined GitHub Pages deployment, [open Onboard](https://mackledorf.github.io/VaultX/Onboard/). VaultX is served separately at the repository root.

## Local development

```bash
npm ci
npm run dev
```

The app runs at the local Vite address shown in the terminal. The FFmpeg/WASM runtime is bundled as an app-owned build asset and runs locally in the browser.

## Editing and export

- Accepts MP4, MOV, and WEBM videos plus GIFs from the user's device without product-imposed input size, duration, or dimension caps. GIFs are converted locally to a temporary MP4 for preview and editing; WEBM preview depends on browser codec support. HEVC/H.265 support also depends on browser and bundled FFmpeg codec support; practical support depends on browser memory and available device resources. HEIC/HEIF still images are not video sources.
- The Source panel offers local upload, direct MP4 URL loading, and Stitch. Stitch accepts multiple local MP4/MOV files, joins them in selection order into one temporary MP4, and replaces the current source for editing. Clips are normalized to a shared frame size while preserving their aspect ratios and audio; silent clips receive silence when other clips have audio. Stitching re-encodes the video and may take time or require substantial browser memory.
- On phones and narrow screens, the editor keeps the preview large and uses centered buttons in a full-width bottom bar to switch among Video, Adjust, and Crop. The Video panel has a compact thumbnail timeline; Adjust uses a horizontal icon chooser and one slider; Crop combines playback rate, rotation, and crop presets. A header action menu provides Export, Source, and Stitch, and Source and Stitch use local device pickers. The desktop layout continues to show its editing panels beside the preview.
- The Source link button accepts direct MP4 URLs that allow cross-origin access (CORS). With the optional Chrome extension and site permissions enabled, it also accepts supported public X and Redgifs post URLs; other page URLs, DRM, and segmented streams are not supported.
- Supports timeline trimming, splitting/removing sections, clicking kept timeline regions to seek, global Space playback toggle, and frame-by-frame left/right arrow-key scrubbing; double-click the playhead to reveal the cut action. Also includes 90-degree rotation with reset, freeform crop with reset, per-section playback speeds from 0.5x to 2x in 0.1x increments, and image adjustments.
- Uses the bundled Roboto Mono variable typeface throughout the interface. The UI uses three type sizes and a regular/medium/bold weight scale.
- Exports H.264 MP4 at 30 fps and up to source resolution, with AAC audio when the source has audio. Section trims and playback speeds apply to audio as well as video. There are no product-imposed output-size caps or pre-export size estimates; the export notification reports the actual encoded size after completion. Large exports may still be limited by browser memory, processing time, or device resources.
- Shows adjustment changes live rather than encoding the whole video after each edit. The preview approximates the export: temporal denoising, scaling, color conversion, and MP4 compression can produce differences. If graphics acceleration is unavailable, Onboard reports that it is using a simpler live preview. Lighting controls from Exposure through Brightness range from -50 to +50 in steps of 5; other adjustments keep their existing ranges and steps.
- Before starting FFmpeg, Onboard validates the edit recipe and verifies that the crop can produce encodable dimensions. Device-dependent failures such as browser memory exhaustion cannot be predicted reliably; Onboard still reports those when the encoder encounters them.
- Exports use temporary browser Blobs and object URLs, which are released when no longer needed.

Large files or long/high-resolution encodes may use substantial browser memory and CPU; the browser can run out of resources while loading or exporting. Onboard surfaces processing errors rather than silently truncating media. The source video remains on the device; no upload endpoint or server-side export service is part of this app.

## Browser extension

Download the extension ZIP from the Onboard wordmark menu; installation instructions appear automatically. Unzip it, keeping the extracted folder in place. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. For development, the extension source is in `onboard/extension`. Opera GX supports many Chromium extensions; validate the current GX developer-mode flow and API compatibility before distributing it there.

The extension scans the active page on demand and lists direct MP4 URLs it can identify in video/source elements, links, or page resource entries. Scanning uses active-tab access and does not continuously monitor sites. Detection is best-effort; it does not support DRM, HLS/DASH, or every MP4 a site may load. “Best observed” means the highest resolution found in the page metadata, not necessarily the site's highest available rendition.

Choosing a source opens Onboard with the URL in a temporary fragment. Onboard removes it from the address bar and fetches the source directly into its existing browser-local editor flow. The Source panel's link button offers the same import flow for a pasted URL. The source host must allow this cross-origin request (CORS); authentication, signed-link expiry, and server policy may prevent import. On failure, use the existing file picker or drag-and-drop. The extension and Onboard do not upload the video or save it as an intermediate download.

To import a supported public X or Redgifs post, open the extension popup and enable the desired site's imports when prompted for site permissions. Then paste the shared post URL into Onboard's Source link field. Reload Onboard after installing or updating the extension. The extension resolves and fetches the first supported MP4 locally and transfers its original bytes to the editor; existing audio is preserved. No account credentials are requested or sent, and no media is uploaded to an Onboard server. Imports can be cancelled in the Source panel.

The feature is intended for desktop Chrome; mobile browsers may not support this extension. Provider endpoints and media availability can change, and public posts may still be inaccessible or offer only unsupported formats. The extension cannot unlock private posts, DRM, or protected streams. Use media you have permission to edit and follow the source site's terms. If an import fails, use a local file instead. For local development, the bridge also supports Onboard at `localhost` or `127.0.0.1` on ports 4178 and 5173.

## Build and tests

```bash
npm test
npm run build
```

GitHub Pages builds set `ONBOARD_BASE_PATH=/VaultX/Onboard/` so app assets load from Onboard's subpath. Local development and builds default to `/`.

## GitHub Pages deployment

Set the repository's **Settings → Pages → Build and deployment** source to **GitHub Actions**. The combined deployment workflow tests and builds VaultX and Onboard, then publishes VaultX at [https://mackledorf.github.io/VaultX/](https://mackledorf.github.io/VaultX/) and Onboard at [https://mackledorf.github.io/VaultX/Onboard/](https://mackledorf.github.io/VaultX/Onboard/). Changes to either app or the deployment workflow on `main` trigger a new combined deployment.

Roboto Mono is bundled from `@fontsource-variable/roboto-mono` and is licensed under the SIL Open Font License 1.1. See [third-party notices](./THIRD_PARTY_NOTICES.md).

## Third-party runtime licensing

The browser bundle includes `@ffmpeg/core` 0.12.10, licensed under GPL-2.0-or-later. Review and satisfy its applicable source and notice obligations before hosting or redistributing a production build. See [third-party notices](./THIRD_PARTY_NOTICES.md).
