# Onboard

Onboard is an independent, browser-based MP4 video editor. It is not part of VaultX and does not use VaultX's API, authentication, database, or file storage. Video selection, preview, and GIF processing happen in the browser; exported GIFs are offered as direct downloads and are not uploaded or saved to a server.

**v0.2 "Working Build"** — after its first GitHub Pages deployment, [open Onboard](https://mackledorf.github.io/VaultX/) directly. This site serves only Onboard; it does not launch or connect to VaultX.

## Local development

```bash
npm ci
npm run dev
```

The app runs at the local Vite address shown in the terminal. The FFmpeg/WASM runtime is bundled as an app-owned build asset and runs locally in the browser.

## Editing and export

- Accepts MP4s from the user's device without product-imposed input size, duration, or dimension caps. Practical support depends on browser memory, codec support, and available device resources.
- Supports timeline trimming, splitting/removing sections, 90-degree rotation with reset, freeform crop with reset, per-section playback speeds from 1x to 2x, and image adjustments.
- Uses the bundled Roboto Mono variable typeface throughout the interface. The UI uses three type sizes and a regular/medium/bold weight scale.
- Exports GIF at up to 15 fps. GIF's 256-color palette cannot preserve every color in the source.
- Exported output is held in a browser Blob until the user downloads it. Closing or changing the edit revokes its temporary object URL.

Large files or long/high-resolution encodes may use substantial browser memory and CPU; the browser can run out of resources while loading or exporting. Onboard surfaces processing errors rather than silently truncating media. The source video remains on the device; no upload endpoint or server-side export service is part of this app.

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
