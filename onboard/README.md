# Onboard

Onboard is an independent, browser-based MP4 and MOV video editor. It is not part of VaultX and does not use VaultX's API, authentication, database, or file storage. Video selection, preview, and GIF processing happen in the browser; exported GIFs are offered as direct downloads and are not uploaded or saved to a server.

**v0.2 "Working Build"** — after its first GitHub Pages deployment, [open Onboard](https://mackledorf.github.io/VaultX/) directly. This site serves only Onboard; it does not launch or connect to VaultX.

## Local development

```bash
npm ci
npm run dev
```

The app runs at the local Vite address shown in the terminal. The FFmpeg/WASM runtime is bundled as an app-owned build asset and runs locally in the browser.

## Editing and export

- Accepts MP4 and MOV videos from the user's device without product-imposed input size, duration, or dimension caps. HEVC/H.265 video support depends on browser and bundled FFmpeg codec support; practical support also depends on browser memory and available device resources. HEIC/HEIF still images are not video sources.
- The Source panel offers local upload, direct MP4 URL loading, and Stitch. Stitch accepts multiple local MP4/MOV files, joins them in selection order into one temporary MP4, and replaces the current source for editing. Clips are normalized to a shared frame size while preserving their aspect ratios; stitching re-encodes the video and may take time or require substantial browser memory.
- On phones and narrow screens, the editor keeps the preview large and uses centered buttons in a full-width bottom bar to switch among Video, Adjust, and Crop. The Video panel has a compact thumbnail timeline; Adjust uses a horizontal icon chooser and one slider; Crop combines playback rate, rotation, and crop presets. A header action menu provides Export, Source, and Stitch; export opens format/quality settings, while Source and Stitch use local device pickers. The desktop layout continues to show its editing panels beside the preview.
- Also accepts a direct video URL through the link button in the Source panel. The URL must return a directly readable MP4 and allow cross-origin access (CORS); page URLs, DRM, and segmented streams are not supported.
- Supports timeline trimming, splitting/removing sections, clicking kept timeline regions to seek, global Space playback toggle, and frame-by-frame left/right arrow-key scrubbing; double-click the playhead to reveal the cut action. Also includes 90-degree rotation with reset, freeform crop with reset, per-section playback speeds from 0.5x to 2x in 0.1x increments, and image adjustments.
- Uses the bundled Roboto Mono variable typeface throughout the interface. The UI uses three type sizes and a regular/medium/bold weight scale.
- Exports GIF at 15 fps or a silent H.264 MP4 at 30 fps. Choose Low, Medium (default), or High GIF quality: all preserve 15 fps while trading output dimensions and palette colors. GIF has at most 256 colors and stores indexed frames; its size depends on frame count, dimensions, and how much image content changes between frames, not just the MP4's compressed file size. There are no product-imposed output-size caps or pre-export size estimates. The export notification reports the actual encoded size after completion. Large exports may still be limited by browser memory, processing time, or device resources.
- Before starting FFmpeg, Onboard validates the edit recipe and verifies that the crop can produce encodable dimensions. Device-dependent failures such as browser memory exhaustion cannot be predicted reliably; Onboard still reports those when the encoder encounters them.
- Exported output is held in a browser Blob until the user downloads it. Closing or changing the edit revokes its temporary object URL.

Large files or long/high-resolution encodes may use substantial browser memory and CPU; the browser can run out of resources while loading or exporting. Onboard surfaces processing errors rather than silently truncating media. The source video remains on the device; no upload endpoint or server-side export service is part of this app.

## Browser extension

The early MV3 extension source is in `onboard/extension`. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. Opera GX supports many Chromium extensions; validate the current GX developer-mode flow and API compatibility before distributing it there.

The extension scans the active page on demand and lists direct MP4 URLs it can identify in video/source elements, links, or page resource entries. It asks only for active-tab access and does not continuously monitor sites. Detection is best-effort; it does not support DRM, HLS/DASH, or every MP4 a site may load. “Best observed” means the highest resolution found in the page metadata, not necessarily the site's highest available rendition.

Choosing a source opens Onboard with the URL in a temporary fragment. Onboard removes it from the address bar and fetches the source directly into its existing browser-local editor flow. The Source panel's link button offers the same import flow for a pasted URL. The source host must allow this cross-origin request (CORS); authentication, signed-link expiry, and server policy may prevent import. On failure, use the existing file picker or drag-and-drop. The extension and Onboard do not upload the video or save it as an intermediate download.

## Build and tests

```bash
npm test
npm run build
```

GitHub Pages builds set `ONBOARD_BASE_PATH=/VaultX/` so app assets load from the repository's project-site URL. Local development and builds default to `/`.

## Independent GitHub Pages deployment

For the first deployment, set the repository's **Settings → Pages → Build and deployment** source to **GitHub Actions**. Push a change to `main` that touches `onboard/` or this deployment workflow to run the Onboard-only test, build, and deploy pipeline. A successful deployment publishes the editor at [https://mackledorf.github.io/VaultX/](https://mackledorf.github.io/VaultX/); VaultX itself is not built or deployed by this workflow.

Roboto Mono is bundled from `@fontsource-variable/roboto-mono` and is licensed under the SIL Open Font License 1.1. See [third-party notices](./THIRD_PARTY_NOTICES.md).

## Third-party runtime licensing

The browser bundle includes `@ffmpeg/core` 0.12.10, licensed under GPL-2.0-or-later. Review and satisfy its applicable source and notice obligations before hosting or redistributing a production build. See [third-party notices](./THIRD_PARTY_NOTICES.md).
