---
description: "Use before planning or making any Onboard site changes. Defines Onboard's MP4-to-GIF purpose, single-page editing workflow, UI principles, privacy, and required editing tools."
applyTo: "onboard/**"
---

# Onboard: purpose and product rules

## Rules

- Read and follow this document before planning or making any change to the Onboard site. Keep product behavior and design consistent with these principles across iterations.
- Consult [Onboard's changelog](../../onboard/CHANGELOG.md) when investigating prior decisions, regressions, or a request to restore or adjust a previous iteration. Add a dated entry for every substantive site change, including what changed and why.
- Treat Onboard as its own application. Do not connect its runtime, UI, assets, styles, storage, or processing pipeline to VaultX.
- Preserve the single-page editing flow. On mobile, use centered Video, Adjust, and Crop buttons in a full-width bottom panel without leaving the editor page. Keep the action menu limited to Export, Source, and Stitch; use its export settings sheet for output format/quality and device pickers for local media.
- Remove redundancy. Do not repeat the product's purpose, duplicate actions in multiple panels, add panel labels that merely restate their controls, or show helper text/tooltips for interactions that are apparent from the interface. Preserve essential status, accessible names, and error messages.
- Use icons only when they clarify or operate an action; avoid decorative or ambiguous icons that look interactive.
- Design and validate Onboard for desktop and mobile browsers. Use a typical desktop Chrome viewport (for example, 1440×900) and a common phone viewport (for example, 390×844) for integrated browser checks. Chrome is the primary shipping browser; Safari may be used for the user's current visual checks.
- Keep the full editing workspace visible without scrolling at standard desktop browser sizes. On mobile, keep the preview dominant, use a full-width persistent bottom bar, and size the three panels consistently. Keep horizontal scrolling inside the adjustment chooser rather than on the page. Match desktop controls, spacing, colors, and type styles.
- Use a locally bundled monospace interface typeface; do not use ABC Areal, Manrope, or a slab serif. A separate font family for numeric/time readouts is unnecessary when the primary typeface is already monospace. Use no more than three deliberate weights.
- Use only three interface type sizes: brand, section heading, and controls/secondary information. Keep captions and numeric values close in size to controls; use color or typeface, not simultaneous large changes in size and contrast, to distinguish secondary information.
- Current type scale: 20px wordmark, 14px section headings, and 12px controls/secondary information. Keep the 12px text legible with adequate contrast and line spacing.
- Maintain a clear hierarchy: the Onboard wordmark is larger than section headings; section headings are larger and stronger than control labels.
- Use shared spacing and control-size tokens throughout the header, side panels, buttons, and timeline. Keep related buttons consistent in type, weight, padding, height, radius, and color treatment; give the timeline the same deliberate alignment and spacing as the rest of the editor.
- Use at least 40px-high primary/secondary controls, adequate horizontal padding, and layouts that keep button labels intact on desktop and mobile. Use wrapping or a denser grid rather than shrinking labels until they clip.
- Reserve the brightest text for the wordmark and section headings; use a consistent, softer foreground for controls and a slightly muted secondary treatment without making secondary values feel tiny or low-contrast.
- Let right-panel adjustments use the available desktop panel height evenly so every control is easy to reach without scrolling.
- On desktop, keep each adjustment label beside its slider, without separate numeric values. Use uniform standard dividers between adjustments and a fixed-width label column so slider tracks align. On mobile, use a horizontal adjustment chooser and one shared slider; indicate changed values with a teal amount stroke.
- Snap adjustment sliders to increments of 10. Color the track between zero and the current value with the Onboard accent, and keep the slider thumb accented whenever its value is nonzero.
- Disable and visually mute all adjustment sliders until a source video is loaded, matching the disabled treatment of other editor controls.
- Provide a single reset action for returning all adjustments to zero. Align the header's right-side action with the timeline's right inset while keeping the wordmark's left inset unchanged.
- Center primary playback in the desktop timeline header, directly above its track. On mobile, place playback at the left and center the time counter.
- Keep the timeline's empty-state background unchanged before media is loaded. With media loaded, show aspect-ratio-preserving frame previews across the track under a faint neutral overlay, trim handles at kept-section boundaries, leave kept footage visually clear of filled bars, and make excluded ranges noticeably darker rather than marking kept ranges green. Use a neutral gray vertical playhead with triangular ends; section labels show playback rate without numbering.
- Show subtle gray tick marks at contiguous cut boundaries, and keep excluded sections only slightly darker than before.
- If a requested change appears to conflict with this document, explain the conflict and resolve the product direction before changing site behavior.
- Do not impose arbitrary file-size or video-duration product limits. Onboard is an ephemeral tool: media is processed for the current edit, not uploaded to a library or retained for later use. Be transparent about actual browser or format constraints rather than silently dropping or truncating media.

## Purpose

Onboard is a focused video-editing pipeline and a quick-format alternative to broader tools such as Lightroom or Premiere Pro. Its specific job is to turn MP4 and MOV videos into short-format GIFs while preserving as much of the source media's quality as the GIF format allows.

The workflow is unidirectional and ephemeral:

1. Select an MP4 or MOV video from the user's device.
2. Preview and edit it on the page.
3. Export the finished GIF directly to the user's Downloads.

Onboard is not a drive, media library, or place to upload and save source files for later. Do not send source media to VaultX or persist it on a server.

## User interface

“Form should match function.” Onboard is a single-purpose tool for efficiently reformatting media, including repeated, high-volume work. Make the workflow obvious and direct.

### Lay it all out on the table

- Show desktop editing tools directly on the editor page. On mobile, keep editing controls in the Video, Adjust, and Crop panels; the action menu is only for export/source/stitch operations.
- Keep the controls discoverable before a video is selected; make the media area an obvious place to begin.
- Keep the path from selecting media to downloading the GIF short and uninterrupted.

### Reuse familiar editing patterns

- Do not invent a novel editor layout. Reuse conventions already familiar from established video and photo editors.
- Give the video a large, central position in the workspace.
- Keep adjustment panels visible beside the media on desktop. On mobile, keep the preview visible while bottom tabs switch between Video, Adjust, and Crop.
- Place the video timeline directly below the video, along the bottom of the editing workspace.
- Center playback controls in the desktop timeline header. On mobile, keep playback on the left, the counter centered, and cut/remove actions on the right without overlap.
- Optimize the editor for desktop PC browser dimensions and usable phone layouts; use the existing editor page rather than separate mobile routes.
- Use panel space for controls, not redundant panel titles, export/source summaries, format reminders, repeated durations, or generic usage tips. Keep export progress, processing errors, and other information needed to complete or recover from an operation.
- Make control labels readable and fit all adjustment controls in the standard desktop viewport without requiring panel or page scrolling.
- Keep rotation and crop in distinct, clearly labeled sections. Rotation is a one-way 90-degree step control; crop offers 1:1, 3:4, and 16:9 presets, and Reset crop returns to full-frame freeform. Label per-section speed controls "Playback Rate" and the image adjustment panel "Adjustments".
- Place source selection/replacement in a "Source" section below Playback Rate in the left panel. Keep drag-and-drop and initial browse affordances in the preview, but do not show a second replacement button over the preview after a source is loaded.
- Keep Source actions to three 40px icon buttons: choose/replace a video, load a video URL, and stitch multiple local videos. Give icon-only buttons accessible names and tooltips; show stitch progress inline without adding a modal or page.

## Functionality

### Media handling and export

- Accept MP4 and MOV video selected from the user's device and provide an in-page preview. HEVC/H.265 playback depends on codec support in the browser and bundled FFmpeg build.
- Let users select multiple MP4/MOV files and stitch them in selection order into one temporary local video before replacing the current source. Normalize clips to a shared frame size while preserving aspect ratio; keep the operation ephemeral and report actual browser/decoder/encoder failures.
- Keep the workflow local and temporary. Do not add a media library, account, cloud upload, VaultX API call, or persistent source-file storage.
- Do not set arbitrary input file-size or source-duration limits. Support the media the user's device can practically process; if browser, memory, codec, or output-format constraints prevent an operation, explain the actual constraint clearly.
- Queue exports from a snapshot of the current source and edits, automatically download each finished output, and allow the user to continue editing another video while exports run. Show dismissible progress notifications under the Export control; completed notifications disappear automatically. Do not treat export as an upload or library save.
- Preserve FFmpeg diagnostic logs and show specific, bounded explanations for source decoding, edit-filter, GIF palette, memory, timeout, and other export failures. Do not imply an arbitrary trim-duration limit or claim a source file is damaged without supporting diagnostics.
- Preserve visual quality as much as GIF's palette and practical output constraints permit; explain meaningful format trade-offs rather than implying GIF can retain every property of the MP4.

### Timeline editing

- Scrub through the footage in the timeline.
- Show the current playhead time and total source duration beside the Timeline heading as `MM:SS:CC / MM:SS:CC` (minutes, seconds, centiseconds), followed by the retained, speed-adjusted output duration as `MM:SS:CC total`. Keep time readouts at two decimal places.
- Show subtle tick marks at 25%, 50%, and 75% of the blank timeline track before a video is loaded.
- Drag the playhead to scrub; clicking elsewhere on the timeline must not seek.
- Update the video preview continuously while the playhead is dragged, not only after the drag ends.
- With the timeline focused, Left and Right Arrow move the playhead by one source video frame per press; holding either key for one second starts scrubbing at four times the active section's playback rate.
- Clicking the video toggles the crop-mark overlay without changing playback. Pressing Space while the video is focused plays or pauses it.
- Crop presets always show the crop-mark overlay.
- After timeline trimming, hide the playhead, pause playback, and ignore video time updates until playback resumes. Park at the first kept section; the playhead returns only when playback resumes from there.
- While dragging a trim handle, continuously preview the frame at the moving trim boundary; after release, briefly show that frame before restoring the prior playhead position.
- Playback should cross contiguous cut boundaries without seeking or pausing, adjusting the playback rate at frame boundaries; skip removed gaps and continue playback.
- Cut is a single-click action that splits the section at the current playhead position; it is not a toggle or timeline click mode.
- Before the first cut, do not allow section selection; keep trim handles available on the single section.
- After a cut creates multiple sections, make the section under the playhead the active editing section: show its trim handles and highlight those handles rather than filling the whole section. Scrubbing or playback into another section transfers the active trim handles and per-section speed target to that section. Remove the active section, falling back to the last selected section only when the playhead is outside kept footage.
- Split footage into segments and disable or delete unwanted parts from the exported sequence.
- Allow playback speed to be adjusted for individual segments so the user can make selected sections faster without changing every segment.
- Make kept and excluded sections and the current playhead easy to understand at a glance.
- Let the user rename the media from its header title; convert whitespace in the name to hyphens. Before renaming, show the uploaded source filename; after renaming, use a `.gif` suffix in the title and GIF download.

### Video and crop editing

- Allow the user to rotate the video.
- Support dynamic, freeform crop/aspect-ratio adjustment rather than requiring a fixed crop preset.
- Show the full uncropped source aspect ratio while crop marks are visible. When crop marks are hidden, fit and clip the preview to the selected crop's aspect ratio; toggling the marks back on restores the full source view and crop overlay.
- Allow freeform crop resizing from all four corners and all four edges. Keep drag coordinates relative to the pointer-down position and capture the pointer on a stable frame element so crop handles do not jump as the selection changes.
- Add an inverse-aspect control beside Reset crop to switch selected presets between landscape and portrait (for example, 16:9 and 9:16).

### Lighting and detail adjustments

Keep familiar photo-editor adjustments available directly in the workspace, including:

- Exposure and brilliance
- Brightness and contrast
- Highlights and shadows
- Vibrance and saturation
- Denoise and sharpening
- Clarity

Adjustments should update the preview and be applied to the exported GIF. Sharpness, definition, clarity, and denoise are increase-only adjustments. Let users save in-session frame previews with their adjustment combinations and switch among them in a scrollable gallery without persisting source media or saved looks. Double-clicking a saved frame reveals an overlay with a delete action. Keep the labels and controls understandable without requiring users to search through nested panels.
