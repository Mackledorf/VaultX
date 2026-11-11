# Onboard changelog

This log records product and interface iterations so prior decisions can be understood and individual changes can be reviewed or restored without undoing unrelated work. For older milestones, exact dates were not recorded.

## 2026-11-11

### Improved live timeline previews and cut playback

- Throttled timeline scrub seeks to animation frames and flush the final seek on release so the video updates during dragging.
- Previewed trim-boundary frames continuously while dragging a trim handle, then restored the previous playhead position after release.
- Avoided unnecessary seeks at contiguous segment boundaries and tolerated small timestamp rounding differences so playback continues smoothly across cuts.
- Rationale: keep the preview responsive during scrubbing and trimming, and prevent playback from stalling or jumping at adjacent cuts.

### Restored detail adjustments and clarified crop framing

- Added preview filters for sharpness, definition, clarity, and denoise, and made all four controls increase-only like denoise.
- Added subtle gray timeline ticks at contiguous cut boundaries and slightly darkened removed sections.
- Kept the full source aspect ratio visible with crop marks; hiding the marks now previews the cropped aspect and shows only the selected crop. Toggling the marks back on restores the full source view.
- Rationale: make detail adjustments visible again, clarify cut positions, and make the crop preview accurately represent the selected output when crop marks are hidden.

### Added a timeline timecode

- Added an `HH:MM:SS / HH:MM:SS` readout beside the Timeline heading to show the current playhead position and total source duration.
- Rationale: let users see their position in the video while scrubbing and editing.

### Added saved-frame deletion

- Double-clicking a saved frame now displays a gray overlay with a trash action; deleting the frame removes it from the in-session gallery.
- Deferred single-click look application so double-clicking to reveal the delete action does not apply the look.
- Rationale: let users remove saved snapshots without adding persistent storage or cluttering every gallery card with another control.

## Earlier milestones (dates not recorded)

### Separated Onboard from VaultX

- Established Onboard as its own application under `onboard/`, with an independent project structure, dependencies, assets, styles, build, and validation workflow.
- Removed runtime dependence on VaultX services. Video selection and GIF creation run in the browser, and completed GIFs download directly rather than being uploaded to VaultX or stored in a server-side media library.
- Rationale: Onboard is an ephemeral, single-purpose formatter, not part of VaultX's media storage product.

### Defined the product and editing workflow

- Added the Onboard purpose instructions to keep the MP4-to-GIF purpose, local processing, familiar single-page editor pattern, and editing capabilities consistent across changes.
- Rationale: a concise product reference reduces interpretation drift and keeps future changes aligned with the tool's focused workflow.

### Built the first full editing workspace

- Replaced the splash-page direction with an editor workspace: a central media preview, transform and section-speed controls on the left, light/color adjustments on the right, and a timeline below.
- Added local video preview, timeline section editing, per-section playback speed, crop and rotation, image adjustments, and browser-based GIF export.
- Removed arbitrary source-duration, input-dimension, section-count, and output-size product caps; practical browser and device resource constraints remain.
- Rationale: keep editing tools visible and provide a direct path from source MP4 to downloaded GIF without turning the app into a general media library.

## 2026-11-07

### Simplified the editor and fit the desktop workspace

- Centered playback above the timeline; removed the non-interactive Clip/Image panel banners and ambiguous decorative icons.
- Removed the duplicate Source and Export sections, source-size and format reminders, repeated timeline duration summary, and visible timeline instructions/tooltips. File selection and replacement remain available from the central canvas; export and download remain in the header.
- Kept actionable export progress and cancellation in the header so the duplicate export panel could be removed without hiding necessary status or recovery controls.
- Increased control, adjustment, and timeline typography while tightening the adjustment rows and workspace proportions. Standard desktop layouts now fit the visible tools without internal panel scrolling; smaller screens retain a scrollable layout.
- Updated the product instructions with explicit guidance on redundancy, purposeful icons, readable type, desktop fit, and consulting this changelog.
- Rationale: prioritize visible, actionable tools; remove information that restates the app's purpose or the controls themselves; and honor the single-page “lay it all out” workflow without sacrificing readability.

### Consolidated playback and refined adjustment controls

- Removed the separate timecode/playback strip under the preview and moved the centered play/pause control into the timeline header. Increased the timeline workspace to use the reclaimed vertical space.
- Removed the transform status hint that repeated crop mode and the default rotation.
- Reworked light/color adjustments into full-width slider tracks with a compact square thumb and neutral track colors instead of narrow tracks and high-contrast circular handles.
- Rationale: keep playback alongside the timeline it controls, remove redundant status, and make every adjustment easy to reach and visually quieter.

### Refined typography, spacing, and tool hierarchy

- Replaced ABC Areal with a locally bundled Manrope Variable typeface. Kept monospace limited to timeline and numeric readouts, and standardized UI weights to regular, medium, and bold.
- Established shared spacing and control-radius tokens, aligned panel and timeline padding, and clarified hierarchy with stronger section headings and consistent button sizing.
- Split rotation and crop into distinct sections with separate reset actions. Renamed "Section speed" to "Playback Rate" and "Light & color" to "Adjustments".
- Made the adjustment list distribute its rows across the full available height of the right panel on desktop, while preserving comfortable row heights and page scrolling on smaller screens.
- Updated the project instructions, README, and third-party notices for the new visual system and font license.
- Rationale: make the interface feel contemporary without external font requests, make control groups easier to scan, and remove visual inconsistency in spacing and timeline alignment.

### Reduced type and spacing tension for browser layouts

- Replaced Manrope with the locally bundled Roboto Mono variable typeface throughout the interface. Consolidated interface text into three sizes: 20px wordmark, 16px section headings, and 14px controls/captions. Captions and adjustment values are no longer substantially smaller than their labels.
- Standardized buttons to 40px minimum height and shared spacing/padding tokens. Changed playback-rate choices to a three-column grid so long labels such as 1.25× and 1.75× fit within the left panel without clipping.
- Reduced the gap between the empty-state prompt and file picker, and softened control and secondary text colors while preserving the wordmark and section headings as the brightest type.
- Tuned the short-desktop-height timeline and header proportions for typical Chrome/Safari content viewports; mobile remains vertically scrollable.
- Reviewed [USWDS typesetting guidance](https://designsystem.digital.gov/design-tokens/typesetting/overview/), [spacing units](https://designsystem.digital.gov/design-tokens/spacing-units/), and [button guidance](https://designsystem.digital.gov/components/button/). Applied a limited type scale, a consistent 4/8px-based spacing system, and larger, consistent selectable button surfaces.
- Updated the project instructions, README, and third-party notices for the new hierarchy and font license.
- Rationale: use fewer, more consistent visual distinctions; keep secondary information legible without competing with its labels; and prevent button clipping or cramped controls in standard browser windows.

### Refined adjustment list dividers

- Added a divider above Exposure and removed the trailing divider below Denoise.
- Rationale: frame the adjustment list cleanly without a dangling line after its final control.

### Reduced editor type sizes

- Reduced section headings from 16px to 14px and controls/captions from 14px to 12px; kept the wordmark at 20px.
- Updated the product instructions with the current type scale and legibility guidance.
- Rationale: slightly reduce visual density while preserving the three-level hierarchy.

### Balanced adjustment panel spacing

- Increased the space below the Adjustments heading and removed the section's bottom padding so the final adjustment row reaches the panel boundary.
- Preserved equal-height adjustment rows by keeping the list distributed evenly over the remaining panel height, including at shorter desktop heights.
- Rationale: improve separation between the heading and first control while removing unused space below Denoise.

### Added temporary adjustment layout comparison

- Added numbered controls beside Adjustments to compare three presentations: labels beside number-free sliders, stacked labels and values with a smaller circular thumb, and single-open adjustment sliders.
- Kept adjustment values intact when switching between layouts and retained all adjustment rows within the panel.
- Documented that the comparison controls are temporary and should be removed after a layout direction is chosen.
- Rationale: let the user evaluate spacing and slider affordance directly in the editor without committing to a permanent design prematurely.

### Selected the compact adjustment layout and grouped controls

- Removed the temporary layout switches and the stacked-value and collapsible variants, keeping labels beside number-free sliders.
- Emphasized the dividers after Brightness and Vibrance with a thicker, higher-contrast line to group tonal, color, and detail adjustments.
- Updated the product instructions to reflect the selected layout and divider treatment.
- Rationale: retain the always-visible adjustment workflow while giving related controls clearer visual grouping.

### Softened adjustment group dividers (2026-11-08)

- Restored the standard divider style after Brightness and Vibrance.
- Lowered the contrast of dividers within the tonal, color, and detail groups.
- Updated the product instructions to match the quieter divider hierarchy.
- Rationale: distinguish related adjustments subtly without adding visually heavy separators.

### Standardized adjustment dividers and slider alignment (2026-11-08)

- Returned every adjustment divider to the same standard color and thickness.
- Set a fixed-width label column so all slider tracks, including their center points, align vertically.
- Updated the product instructions to retain uniform dividers and aligned sliders.
- Rationale: remove inconsistent group separators and make adjustment positions easier to compare at a glance.

### Snapped and highlighted adjustment values (2026-11-08)

- Changed adjustment sliders to snap in increments of 10.
- Accent-colored the track distance from zero to the selected value and the thumb whenever an adjustment is nonzero.
- Updated the product instructions with the snapping and changed-value visual behavior.
- Rationale: make adjustment increments deliberate and show at a glance which controls differ from their defaults and by how much.

### Added reset-all control and aligned header action (2026-11-08)

- Added an accessible reset icon beside Adjustments to return every adjustment slider to zero; it is disabled when all values are already at their defaults.
- Reduced only the header's right inset to align Export GIF with the timeline's right edge. Kept the wordmark's existing left inset.
- Updated the product instructions with these reset and alignment conventions.
- Rationale: make restoring the default image treatment immediate and align right-side actions without disturbing the established wordmark position.

### Disabled adjustments until media is loaded (2026-11-08)

- Disabled all adjustment sliders until the user loads a video and muted their labels and tracks with the same reduced-opacity treatment used by other disabled editor controls.
- Kept adjustment controls fully visible so the editor layout remains discoverable before media selection.
- Updated the product instructions to define this pre-media state.
- Rationale: communicate that adjustments require source media while preserving the always-visible editor workflow.

### Moved source replacement to the left panel (2026-11-08)

- Added a Source section below Playback Rate with a file chooser that reads "Choose MP4" before selection and "Replace media" after a video is loaded.
- Removed the Replace video overlay from the preview; kept the initial browse and drag-and-drop affordances.
- Moved the existing MP4 input into the Source section and updated product instructions.
- Rationale: keep media management with the other visible editor tools while leaving the preview focused on the footage.

### Added crop aspect-ratio presets (2026-11-08)

- Removed the separate Reset rotation button, keeping rotation as a single 90-degree step action.
- Added 1:1, 3:4, and 16:9 crop presets above Reset crop. Presets center the crop and account for the video's displayed orientation.
- Reset crop now restores the full-frame freeform crop; manually moving a crop handle exits the selected preset.
- Updated the product instructions to document the simplified rotation and crop workflow.
- Rationale: offer familiar output ratios without hiding freeform crop or adding extra reset controls.

### Tightened crop control spacing and clarified desktop browser target (2026-11-08)

- Reduced the vertical gap in the Crop section to 8px, matching the gap between Playback Rate rows.
- Updated Onboard's instructions to target desktop PC browsers, use a standard integrated desktop Chrome viewport, and treat small-device layout testing as out of scope.
- Rationale: align crop controls with the established spacing rhythm and focus design verification on the browsers and dimensions Onboard will actually serve.

### v0.1 "Foundational Build" (2026-11-08)

- Marked Onboard package version `0.1.0` as its first working draft and foundational product checkpoint.
- This baseline includes the standalone browser-local MP4-to-GIF workflow, single-page editor, timeline editing, rotation and crop presets/freeform crop, image adjustments, and local GIF download.
- Use this version label and package version to identify the foundational build when reviewing future changes or planning a restoration.

### Next development focus: timeline editing and media naming (2026-11-08)

- Treat the changes recorded above as the v0.1 foundational baseline; they are established context, not the scope of the next feature iteration.
- Focus upcoming development on editing through the timeline and naming the user's media.

### Refined timeline trim and playhead visuals (2026-11-08)

- Removed the green filled kept-section bars. Kept ranges now retain the existing track background, with neutral trim handles at segment edges and low-contrast overlays on excluded ranges.
- Replaced the white/red playhead marker with a neutral gray time bar and triangular end markers.
- Removed section numbering from visible timeline labels; playback rate remains visible.
- Preserved the empty timeline appearance when no media is loaded and documented these timeline conventions in the Onboard instructions.
- Rationale: make trims and excluded footage clear without the timeline reading as a green clip bar, and bring playhead styling in line with the rest of the interface.

### Added trim ticks and drag-only scrubbing (2026-11-08)

- Added inward-facing tick marks at the top and bottom of each timeline trim handle.
- Changed timeline scrubbing so it starts only by dragging the playhead; clicking elsewhere no longer seeks. Keyboard scrubbing remains available.
- Made the playhead keyboard-focusable and exposed its current time as a slider value.
- Rationale: clarify trim boundaries and prevent accidental seeks when selecting or working with timeline sections.

### Made timeline cuts and section removal direct (2026-11-08)

- Changed Cut from a toggle into a single action that splits the section at the current playhead; it is disabled when the playhead is not inside a splittable section.
- Kept section selection on direct timeline clicks without moving the playhead. Remove section continues to remove the selected section when more than one exists.
- Removed the former cut-mode interaction so trimming remains available at all times and timeline clicks do not create cuts or seek.
- Rationale: make cut placement depend on the scrubbed playhead and make selection explicit before removing footage.

### Limited section selection and focused trim handles (2026-11-08)

- Prevented selection before the first cut while keeping the lone section's trim handles available.
- After a cut, only the selected section displays trim handles; selecting a different section moves the handles without moving the playhead.
- Highlighted the selected section's trim handles rather than outlining the full section.
- Kept selection independent of playback and scrubbing, so the user's chosen section remains the crop/trim target.
- Rationale: reduce visual clutter after splitting and make the active section's trim controls unambiguous.

### Enlarged timeline drag targets without changing visuals (2026-11-08)

- Expanded the invisible pointer targets for trim handles and the playhead while keeping their visible bars and ticks the same size and position.
- Rationale: make trimming and scrubbing easier to grab without increasing timeline visual weight.

### Toggled crop marks and reset scrubbing after trims (2026-11-08)

- Changed video clicks to show or hide crop marks, and made Space on the focused video play or pause.
- After a timeline trim, pause playback and hide the playhead. On the next play action, restart from the first kept section and restore the playhead after playback successfully resumes.
- Rationale: make crop visibility user-controlled and prevent the playhead from remaining outside a newly trimmed range.

### Kept playback keyboard control separate from crop marks (2026-11-08)

- Restored Space as a play/pause command when the video has keyboard focus; crop marks are toggled only by clicking the video.
- Removed the green focus outline from the video preview so clicking it only changes crop-mark visibility.
- Rationale: preserve expected keyboard playback behavior and avoid a selection-like outline on the canvas.

### Restored crop overlay from presets and stabilized trimmed playback (2026-11-08)

- Made each crop preset show the crop-mark overlay.
- Guarded playhead time updates after timeline trimming, parked the paused video at the first kept section, and restored the playhead only after playback resumes from there.
- Applied the same trim/playhead reset when adjusting trim handles with the keyboard.
- Rationale: keep crop presets immediately visible and prevent late video time updates from moving the hidden playhead to the end of the video.

### Added frame stepping and source renaming (2026-11-08)

- Changed Left/Right Arrow timeline navigation to move by one video frame, using the observed frame cadence when available and 30 fps as an initial fallback.
- Made the header video name editable on click. Whitespace becomes hyphens, the source filename is shown before renaming, and GIF downloads use the renamed base name.
- Rationale: support precise timeline review and make exported media names easy to identify without changing the source format.

### Updated renamed media extension (2026-11-08)

- Kept the uploaded `.mp4` filename in the header until the user renames it; renamed titles now end in `.gif`.
- Continued to use the renamed base name for GIF downloads.
- Rationale: make the displayed file type reflect the exported media format after naming.

### v0.2 "Working Build" (2026-11-08)

- Packaged the completed standalone MP4-to-GIF editor as Onboard v0.2.0, including local source handling and GIF export, crop/rotation and image adjustments, timeline trimming/cutting/removal, frame-by-frame scrubbing, and media naming.
- Set the browser tab title to `Onboard - MP4 to GIF`.
- Added an independent GitHub Pages deployment that builds only `onboard/` and publishes it at `https://mackledorf.github.io/VaultX/`; the app remains separate from VaultX's server, API, and storage.
- Documented the direct app link and the separate deployment path in the repository and Onboard READMEs.
- Rationale: mark the first complete working build and make the editor directly accessible from the repository without requiring users to open VaultX.

## 2026-11-11

### Fixed preview, export, and timeline editing behavior

- Unified tonal adjustment math between the canvas preview and encoded GIF/MP4 output, including exposure, brilliance, highlights, shadows, contrast, and brightness.
- Added Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z redo for edits; changing edits now invalidates an older export so the updated version can be encoded again.
- Highlighted the timeline section under the playhead independently of the section selected for trimming.
- Briefly previewed the adjusted trim boundary before returning to the previous playhead frame.
- Kept playback continuous across adjacent cuts, skipped removed gaps during playback, and looped from the last kept section to the first.
- Rationale: make the canvas reflect exported tonal edits and keep iterative editing, playback, and export responsive after the first encode.

### Added fast keyboard scrubbing and saved adjustment looks

- Holding Left or Right Arrow now scrubs at four times the active section's playback rate; releasing the key stops scrubbing.
- Added a save-frame action that captures the current preview with its adjustment combination and a toggleable gallery for applying saved combinations.
- Kept saved looks in the current editor session and made the gallery scroll when its saved frames exceed the panel height.
- Rationale: speed up timeline navigation and make adjustment combinations reusable without storing source media or adding persistent storage.

### Added timeline frame previews

- Removed the green active-section bar at the top of the timeline.
- Replaced the gray-only timeline track with sampled video-frame previews, cropped and rotated to match the current output while preserving their aspect ratio.
- Rationale: make footage easier to recognize while scrubbing without distorting its frames or changing trim and excluded-range behavior.

### Matched active clip controls to the playhead

- Made the clip under the playhead the active editing target, with teal trim handles and its playback rate control following scrubbing and playback across cuts.
- Added a neutral 50% dark overlay to timeline thumbnails and darkened excluded ranges further for clear separation from the playhead and trim marks.
- Rationale: let users edit the clip they are previewing and preserve the original timeline's understated contrast and visual hierarchy.
