# basdraw roadmap

This file records future directions discussed for basdraw. Items here are not commitments to a release order and should be validated against real control drawings before implementation.

## Current exploration

The [project review](PROJECT-REVIEW.md) records the architecture findings, completed native-interaction improvements and proposed priorities. Core authoring and after-the-fact editing come before feature expansion. The selected shape now has a Behaviors section in tldraw's style panel, separate from station browsing. The next priority is using this flow on real drawings and refining any remaining friction, including combined effects and nested groups. Widget image export, richer history and equipment templates remain later work.

The current focus is the local animation and binding experience:

- Existing behaviors first, with expandable settings and explicit Change point actions that retain animation settings.
- Add behavior starts with the effect, then its point, then relevant settings. Numeric ranges are visible; advanced mapping starts collapsed.
- Per-behavior switches retain configuration. Add, save, remove and enable/disable use native undo.
- Keep saved settings editable offline. Browsing points must never silently replace a behavior's driver.
- Support value-positioned and boolean-controlled continuous rotation and movement.
- Keep percentage-fill color and live-value label color directly configurable.
- Let live-value labels use the Niagara point status as their color source.
- Keep every animation presentation-only so disconnecting restores the unchanged tldraw document.

Shapes and groups now support independent, optionally named behaviors. Add behavior always starts a new entry; opening an existing entry edits only that entry. Multiple points can supply multiple value labels, and different effects combine. One enabled behavior owns each exclusive channel: rotation, scale, opacity, visibility, status fill, percentage fill, horizontal movement or vertical movement. Conflicting additions and re-enables are rejected without replacing saved settings. Disabled alternatives are retained. Broader multi-selection editing and reusable behavior presets remain later work.

The September 5 UI pass adds Display/Appearance/Motion categories, zoom-scaled value labels with optional backgrounds and corner roundness, a compact shared header, a floating station browser, and Table/Trend actions in the native toolbar. Data setup now uses native dialogs with editable table previews and conflict checks. Point-to-shape dragging starts new behavior setup. Direct point drops into existing behavior editors remain deferred after unsuccessful browser acceptance; Change point remains the supported replacement flow.

Publishing, deployment, and licensing work are intentionally deferred. basdraw is currently a local, for-fun project that may be shared as a source repository later.

The shape-identity follow-up adds editable automatic names and a Navigation behavior backed by stable shape IDs. Select a linked shape and use Go to center or fit its destination, including across pages. Normal selection stays unchanged; names and navigation remain editable offline and participate in native history.

## Extension hardening before broad expansion

Rotation now supports a normalized, editable pivot with center/edge/corner presets and custom coordinates. Old drawings retain center defaults; scale has a separate origin. The first hardening slice adds a typed behavior catalog and shared conflict rules, stable per-behavior keys, surgical metadata edits that preserve unsupported entries, separate value-label editor/rendering modules, and one mounted settings editor at a time. For inherited effects, the nearest enabled owner takes priority on a shared channel; arbitrary additive ancestor transforms are not implemented. Remaining foundation work includes extracting the other effect editors and validators, indexed runtime subscriptions, provider adapters, explicit shape/behavior migrations, and measured large-drawing benchmarks. See PROJECT-REVIEW.md for the extension acceptance checklist. These are hardening tasks, not completed capacity guarantees.

Imported symbol libraries remain a later feature. Prepare their contract around native shape records, validated/versioned configuration, stable point roles with remapping, and provider-neutral references; do not introduce a library importer or new connector merely to reserve these seams.

## PDF control drawings

Implemented first slice: local Poppler conversion, page preview/selection, painted SVG pieces in native frames, manual grouping and existing Niagara behaviors. Pieces are native image shapes containing vectors, not editable path nodes, and use tldraw's native proportional image-resize behavior. A locked white paper layer preserves drawing contrast in both themes. Artwork-alpha masks keep imported-piece fills off the surrounding rectangle, including black stroked symbols. Native assets, grouping, undo and snapshots are reused; no new persistent shape schema is required.

Remaining: representative user-document acceptance, splitting compound paths into subparts, assisted symbol recognition/remapping, larger-document performance work and browser-only conversion. The initial importer takes one page at a time and excludes scanned pages.

Longer-term direction: use vector PDF control drawings as the visual foundation for live Niagara graphics. Scanned and raster-only PDFs remain outside this scope.

The practical first version should:

1. Import one or more vector PDF pages without flattening the page to a bitmap.
2. Preserve the PDF page at a known scale so extracted elements and runtime shapes remain registered to the drawing.
3. Let the user select related vector paths for a pump, fan, damper, valve, sensor, or other drawing symbol and promote them into a tldraw group or custom shape.
4. Bind the promoted shape or group to Niagara points using the existing runtime label, fill, level, visibility, opacity, rotation, scale, and movement properties.
5. Save the PDF-page placement, promoted vector elements, and bindings while keeping live point values out of the drawing document.

Even in a vector PDF, drawing programs may export a symbol as many unrelated paths rather than one semantic object. The import workflow therefore needs manual path selection and grouping as the dependable baseline. Automatic symbol grouping can be explored later, but is not required for vector PDF support.

A later assisted workflow could recognize repeated vector path patterns and suggest symbol groups. Any automatic grouping must remain editable and should not be treated as reliable until it has been tested against representative Niagara control drawings.

The installed tldraw SDK does not include PDF as a default image asset, but its external-content system explicitly supports adding PDF handling through a custom asset utility. PDF parsing and page rendering would therefore be application work layered on top of tldraw rather than a replacement for the current canvas or binding architecture.
