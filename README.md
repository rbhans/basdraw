# basdraw

basdraw is an early Niagara graphics canvas built on the tldraw Agent Starter Kit. It connects to a Niagara station through baskStream, lets an operator browse or search the station, and binds live point values to native canvas shapes.

Future directions and the scope of vector PDF importing are recorded in [ROADMAP.md](ROADMAP.md).

The first working slice is intentionally narrow:

- Connect to an authorized Niagara station with a local username and password.
- Discover the deployed baskStream capabilities instead of assuming an API version.
- Browse the station slot tree or a Niagara hierarchy.
- Search for readable points and inspect a current value.
- Bind a selected point to a selected tldraw shape as a live value label, runtime status fill, percentage level fill, visibility, opacity, rotation, scale, or movement.
- Map boolean, numeric-range, and enum point values into appearance outputs with an in-panel live preview.
- Place complete live-value labels at the center or outside any side of a shape. Text, spacing and label backgrounds scale with canvas zoom. Choose corner roundness or text without a background.
- Color a live-value label from the point status or choose a custom label color.
- Map rotation to a centered position or continuously spin a shape while a boolean/mapped value is active.
- Map movement to a horizontal or vertical position, or continuously travel out and back while a boolean/mapped value is active.
- Fill closed shapes from any side using a selected color and a mapped 0–100% level.
- Restore the canvas and its binding definitions after a browser reload.
- Create live equipment tables and historical trend charts with editable points and native tldraw style-panel settings.
- Open Table and Trend from the native bottom toolbar. Choose points, then review table rows/columns or chart settings in a tldraw dialog before creating the shape.
- Browse points in a collapsible floating panel, and drag a point onto an unlocked shape or group to begin adding a behavior.
- Duplicate shapes with their bindings, and undo or redo binding changes through tldraw.
- Import vector PDF pages as selectable SVG pieces, group drawing symbols, and attach Niagara behaviors.
- Keep the AI agent code present but hide the agent UI when no model provider is configured.

The current Niagara integration is read-only. The app does not expose baskStream write, alarm action, tag write, or relation write operations.

## Run locally

Requirements:

- Node.js 22.12 or newer
- A Niagara station with the baskStream service installed and running
- Network access from this computer to the station web port
- Optional for PDF import: Poppler (`pdfinfo` and `pdftocairo`) on PATH. On macOS, install with `brew install poppler`.

Install and start both the Vite app and the loopback baskStream bridge:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

The bridge listens only on `127.0.0.1:8788`. It performs Niagara SCRAM authentication, verifies the server-final signature, keeps the authenticated cookies in memory, and converts the browser's local JSON WebSocket messages to the MessagePack frames used by baskStream. Passwords are not written to local storage, canvas data, logs, or source files.

For a station with a local self-signed certificate, enable the per-connection certificate option in the UI. This changes trust only for that station connection.

## Data boundaries

basdraw keeps three kinds of state separate:

1. The tldraw store persists native shapes and their base appearance under `bas-whiteboard-canvas-v1`.
2. BAS binding definitions and value mappings are stored in the owning shape's `meta.basBindings`. Station identity and the one-time migration marker are document metadata. The older `bas-whiteboard.document.v2` record remains untouched as a migration fallback; it is no longer the active binding store.
3. Live point snapshots remain in React memory and are released when the station disconnects.

Connection profiles use a separate `bas-whiteboard.connection-profiles.v1` record. A remembered profile may contain a friendly name, station alias, endpoint, username, and TLS choice. It cannot contain a password or session token.

Runtime labels, status fills, percentage fills, visibility, opacity, rotation, scale, and movement are presentation-only. They do not modify or save the selected shape's base fill, label, opacity, position, rotation, scale, or geometry. Disconnecting therefore removes the live presentation without changing the saved drawing.

Continuous rotation uses the selected pivot (the shape or group center by default). Continuous movement travels along a canvas axis and returns to the saved position on each cycle. One runtime controller per editor uses tldraw's tick clock, with a shared phase per continuous binding so artwork, fills and traveling labels stay synchronized. Numeric transforms, opacity and percentage fills retarget smoothly over 180ms from their displayed state. Animation frames update presentation, not saved geometry or undo history. The editor's reduced-motion preference stops cycles and makes value transitions immediate. See [the runtime extension guide](docs/runtime-animations.md).

Legacy version 1 and 2 BAS records are read once and attached to their existing shapes. Bindings for absent shapes are retained only in the untouched legacy record. A document marker prevents removed bindings from being restored again on reload. Each saved behavior has a stable local key; its runtime identity combines that key with the owning shape ID, so multiple behaviors and clipboard copies remain independently editable. Legacy entries retain property-based keys until normalized by an edit. Unsupported effect/version entries remain in metadata, are excluded from runtime, and survive edits to recognized behaviors. Live snapshots and chart samples stay outside tldraw history.

A selected tldraw group can receive the same runtime bindings as an individual shape. Descendants share the group center and animation timing, so rotation, scale, and movement affect the group as one assembled object while visibility, opacity, status fill, and percentage fill apply across the whole group.

### Editing behaviors

A shape can display several point values at once. Labels on the same side stack in behavior-list order and keep independent captions, colors, backgrounds and spacing. Above/below the shape, the first visible label sets the distance of the stack; subsequent labels use their space-between setting. Left/right labels each retain their horizontal distance. Labels scale with the canvas.

Select a shape or group and open **Behaviors** in the right-hand tldraw style panel. Existing effects appear first. Expand one to edit its settings; **Change point** opens a live-filtered picker and keeps the effect's mapping, timing, colors and placement. The station browser on the left is for inspection, not implicit binding changes. Add behavior creates a separate entry; optional behavior names distinguish similar effects. Conflicting enabled effects are rejected, not replaced. Horizontal and vertical movement are separate channels and may use different points and timings. Disabled alternatives retain their settings. For inherited channels the nearest enabled owner wins; group/child transforms are not additive. Group fill overlays still need more work when descendants have their own independent transforms.

**Add behavior** asks for an effect, then a driving point. Common controls and numeric ranges stay visible, with advanced mapping collapsed. Boolean rotation and movement default to continuous motion while on, including Niagara boolean values returned as `"true"` or `"false"`. Each effect has an enable switch, Save/Cancel and Remove. Disabled effects retain settings and their point data remains available for editing. Native undo restores saved edits, driver changes, removals and enable switches.

Saved settings can be edited offline. Changing a driver requires a connection. Drafts survive collapsing and reopening behavior rows on the same selected shape; Cancel discards them. Selecting a different shape discards unsaved drafts. One instance of each effect can be combined on a shape; selecting an effect already in use opens the existing behavior.

Effects are grouped into Display, Appearance and Motion. A point dropped onto a shape seeds the new-effect chooser; nothing is saved until the behavior is confirmed. Existing drivers still use **Change point**, retaining their animation settings. Direct drops into the behavior panel are deferred until reliable browser acceptance is established.

### Table and trend setup

Use the table or chart icon in the bottom toolbar. Search and select points across equipment, then review the layout. Tables infer equipment rows and shared columns from point paths; the preview lets you rename headers and equipment, adjust point assignments, and see missing cells. Conflicting assignments block saving instead of hiding a point. Select an existing table and choose **Edit table setup** to reopen it. Existing charts expose **Edit points**, range, line style and series colors in their properties.

## baskStream contract

The connection flow follows the current baskStream API contract:

1. Authenticate to Niagara and verify `/stream/health`.
2. Open the authenticated `/stream` WebSocket.
3. Call `capabilities` and adapt to the deployed module.
4. Use shallow `browse` and bounded `search` requests for discovery.
5. Use `read` for a selected point snapshot.
6. Prefer one `replace_subscriptions` group named `canvas:active` for all bound points on the open canvas.
7. Renew the group lease while the view stays connected and release it on disconnect.

The module source remains authoritative for protocol changes. This project was initially checked against the NiagaraFalls/baskStream API 1.5 source and a live API 1.5 station.

## AI foundation

The complete tldraw agent architecture remains in `client/`, `shared/`, and `worker/`. The client checks `/agent/status`; the chat panel is unavailable when no provider key exists.

For local AI development, create `.dev.vars` with at least one supported provider key:

```text
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
```

The BAS document reducer exposes explicit binding actions in `client/bas/types.ts`, and the intended future agent surface is named there:

```text
inspect_canvas
list_bindings
create_binding
update_binding
remove_binding
search_niagara
read_point_values
arrange_shapes
```

Niagara credentials, authenticated cookies, and the complete station database must never be added to an AI prompt. Future point context should stay limited to the selected station metadata and values needed for the active request.

## Rotation pivots

Edit a Rotate behavior and use **Rotate around** to choose center, an edge or a corner. X/Y percentages allow a custom pivot (50/50 is center, values outside 0–100 are outside the shape). The pivot follows the owning shape or group when moved, rotated or resized. Both Follow value and Spin while on use it. Existing drawings default to center. Scaling retains its own center.

## Shape names and navigation

Every shape and group gets an editable name such as Square 1. Select it and edit **Shape name** at the top of the properties panel. Names identify shapes without changing their visible text.

Use **Add behavior → Navigation → Navigate to shape**, choose a destination and select Center (keep zoom) or Fit destination. Select the linked shape and use its **Go to** button to follow the link; ordinary clicks still select and edit. Destinations can be on another page.

Links use stable shape IDs, so renaming or moving the destination does not break them. Deleted destinations disable Go until replaced or restored with Undo. Duplicate shapes get distinct names; duplicated navigation still points to the original destination. Names and navigation are saved with the drawing, support native undo and work without a station connection.

## Vector PDF control drawings

Choose **Import vector PDF** in the bottom toolbar (or More). Choose a local PDF, enter a page number, **Preview page**, then **Import page**. Each page becomes a native tldraw frame with a locked white paper background. Click or Shift-select pieces inside the frame, or drag a selection around the symbol, then use native **Group** (Cmd/Ctrl+G). Add behaviors to the resulting group as usual.

The importer preserves vector curves, source colors, clipping and font outlines. Each painted piece is a native SVG image asset, not a bitmap and not an editable Bézier path. Text runs and compound paths remain intact; compositing groups may also remain a single piece to preserve appearance. Symbols are not automatically recognized. You can move, resize, rotate, duplicate, group and bind the pieces; individual pieces use tldraw's native image resize behavior, so corner-handle resizing preserves their original proportions. Status/percentage fills cover painted artwork and the interiors of closed outlines, including coil contours that return to their starting point without an explicit close command. Open pipes and diagonals retain their ink-only coverage; clipping and compound-path holes are preserved. This works on existing imports without changing the saved artwork. Outlines assembled from separate open pieces still need a closed shape to define their interior.

Conversion runs locally through a separate service on `127.0.0.1:8790`, using Poppler. `npm run dev` starts it alongside the UI and station bridge. If using `npm run dev:ui`, also run `npm run import:pdf`. Files never go to Niagara or an external conversion provider. Temporary conversion files are removed after each request; the saved drawing contains self-contained SVG assets and does not need the source PDF or converter for playback.

Initial limits: one page per import, 25 MB input, 3,000 painted pieces per page and the existing canvas shape limit. Oversized/invalid/password-protected files report errors without replacing the drawing. Raster-only or apparently full-page scanned artwork is rejected; small embedded image regions are retained with a warning. Check the preview for fidelity on your actual drawing before importing. Automatic symbol recognition, splitting compound paths, and browser-only PDF conversion remain later work.

## Verification

### Web Views

Choose **Web View** in the bottom toolbar (or its More menu) and enter an HTTP/HTTPS address. The frame resizes normally; its title and address can be edited in the properties panel. Double-click to interact with the page, then use **Back to canvas** when finished. Selecting Laser or Draw automatically disables page interaction so you can mark over the embedded content without clicking its controls.

Use **Content scale (%)** in Web View settings to zoom the embedded page from 25–400%, independently of the frame size. The header stays the same size; resize handles still change width and height freely. Older Web Views default to 100%. Scaling does not reload the page, and laser/drawing tools still work over it.

Web Views are saved with the drawing and support duplication and undo/redo. The address, title and scale are stored, not browser credentials or page contents. Exported images/SVGs include a placeholder with the title and address, not the live page.

This is an iframe, not an unrestricted browser. Sites can refuse embedding through CSP or X-Frame-Options, browser cookie policies can affect login, and HTTPS canvases cannot generally embed HTTP pages. Niagara PX rendering/login must be tested with the actual station URL; the baskStream connection does not authenticate the iframe. **Open in browser** is available when embedding does not work. No authentication proxy or station-security changes are included.

`/scripts/web-view-qa.html` is an isolated, unsaved test canvas with local embedded content, lifecycle/URL checks, and real laser/draw interaction testing. It never connects to a station.

### Build and regression checks

```bash
npx tsc --noEmit
npm run build
node --test scripts/vector-pdf.test.mjs
```

With the dev server running, open `/scripts/canvas-regression.html` to run thirty-two isolated browser checks for bindings, native history, duplication, clipboard metadata, snapshots, retained driver settings, disabled effects, label appearance, table assignment conflicts, unique shape names, rename validation, navigation after moving or renaming targets, deleted-target recovery cross-page navigation, pivot resizing, group coordinate conversion, pivot persistence and malformed pivot rejection. Additional checks cover multiple labels, independent edits and clipboard copies, conflicting add/re-enable/axis edits, separate movement timings, unsupported metadata preservation, label stacking, locked edits, group precedence and movement-vector conversion. The fixture has no station connection and does not use the saved canvas.

Open `/scripts/behavior-qa.html` for the isolated interactive behavior fixture. It has synthetic temperature, setpoint and fan points, no station connection, and no saved drawing. This is UI/runtime regression coverage, not live-station acceptance.

Open `/scripts/vector-pdf-qa.html` with the local PDF service running for vector extraction/render comparison, clipping/font/rotation fidelity, scan rejection, native import undo/redo, grouping, snapshot reload, and synthetic group animation. It also checks outline-only coil interiors, open pipes, holes, relative paths, and single/group runtime fills. The PDF sample is generated in memory; the fill regression uses an isolated coil outline that reproduced the reported issue.

The architecture review, remaining limitations, and proposed feature priorities are in [PROJECT-REVIEW.md](PROJECT-REVIEW.md).

The production build currently includes the optional Agent Starter Kit worker, which makes the worker bundle much larger than the browser client. Code splitting and a deployment-specific station bridge are later release concerns.

## Licensing

The starter template code includes an MIT license in `LICENSE.md`, but basdraw also depends on the tldraw SDK. The SDK is not permissively open source and has its own production license requirements.

Local development does not require a tldraw production license key. A production deployment requires a valid trial, hobby, or commercial license key under tldraw's current terms. Downstream users of a public repository must obtain their own appropriate production license. Set `VITE_TLDRAW_LICENSE_KEY` for a licensed production build.

Review the current [tldraw license documentation](https://tldraw.dev/community/license) before publishing or deploying the application. The tldraw name and logo remain subject to tldraw's trademark guidelines.
