# basdraw project review

Reviewed September 4, 2026; behavior-authoring follow-up September 5. Scope: local architecture, tldraw integration and interaction, then useful feature directions. Publishing, deployment and licensing remain outside the work.

## Native UI follow-up, September 5

| Before | After |
| --- | --- |
| Full-height station sidebar and separate brand block | Floating, collapsible Points panel and a compact brand in the shared header, using tldraw theme colors and panel shadow tokens. |
| Flat effect chooser | Display, Appearance and Motion groups inside the native properties panel. |
| Value labels remained screen-sized | Text, padding, spacing, corners and shadow scale with the canvas; backgrounds may be removed. |
| Table/trend setup was embedded in the station panel | Native bottom-toolbar items open tldraw dialogs. Table setup previews editable rows and columns and blocks conflicting assignments. Existing setup is reopened from the style panel. |
| Point selection required a separate picker for each new effect | A station point can be dragged onto an unlocked shape or group to seed the new-effect flow. Existing drivers still use Change point. |

Verification for this pass:

- Typecheck and production build passed. The existing large client-chunk warning remains; nothing was deployed.
- All 12 isolated browser regression checks passed, including label-background persistence and table assignment conflicts.
- The existing station connected read-only. Two equipment temperatures created a live table with a renamed column; reopening, saving edits and native undo were exercised. A trend loaded recorded history through the new setup flow.
- In-app DOM measurements confirmed label text scaled from about 3.07px at 30.7% zoom to 5px at 50%. Text-only background changes removed border and padding; undo restored the saved style.
- Screenshots checked the shared header, floating panel and bottom toolbar in both light and dark themes. Light mode was restored.
- Point-to-group dragging opened the categorized chooser with the dropped point. Direct dropping into an existing behavior editor did not pass browser acceptance and was removed from this pass. Keep Change point as the supported replacement flow; revisit panel drops separately.
- Test table/chart shapes were removed. The original five bindings remain. A duplicate React key discovered while switching data settings was corrected; the corrected panel was checked after reload.

The tldraw [UI primitives documentation](https://tldraw.dev/sdk-features/ui-primitives) and installed SDK components guided toolbar, dialog, input and theme integration. The UI-polish checklist guided compact grouping and native panel proportions.

## Shape identity and navigation follow-up

Table and trend toolbar icons now use lighter 1.5px strokes. Shapes and groups receive editable names stored in metadata, while navigation targets use native shape IDs. The Navigation category supports destination selection/search, center or fit framing, editing, disabling and removal. Explicit Go buttons preserve normal canvas selection gestures.

Seventeen isolated browser regression checks passed, including unique batch/duplicate names, rename validation and undo, moved/renamed destinations, deleted-target recovery, persisted metadata and cross-page navigation. The in-app browser also exercised naming, adding navigation and following Go on the existing drawing; both temporary edits were undone. No station connection was required.

## Rotation pivots and extension safety, September 5

The pivot is an optional, validated rotation setting rather than a new animation system. Omission keeps old drawings centered. Geometry conversion is shared by shape rendering and fill overlays, with local bounds transformed through tldraw's page/shape APIs. Scaling now has an independent origin.

| Before | After | Why |
| --- | --- | --- |
| Rotation and scale shared an origin chosen from either effect | Separate rotation and scale origins | Changing a hinge must not change scale behavior. |
| Rotation assumed the center | Presets and normalized custom coordinates in a dedicated control | Supports resizing and keeps the main editor from absorbing the whole control implementation. |

Current strengths verified in source: shape metadata is the saved authority; live values stay outside the drawing; metadata reads have a migration/validation boundary; runtime effects do not write animation frames into native history; continuous spin uses cancellable Web Animations and respects the editor's motion preference. Native ShapeUtil classes remain the route for new shape types, as described in the [tldraw shape SDK documentation](https://tldraw.dev/docs/shapes).

This is a sound local foundation, not a zero-risk or scale-tested platform. Before adding a larger set of features:

1. Split effect-specific editor state and validation out of BindingBuilder into small modules, with a typed effect definition registry for category, defaults, validation and summary. Keep one visible settings editor at a time.
2. Index runtime bindings by shape and point, and narrow snapshot subscriptions. Current wrappers filter the full binding list and the shared runtime context can rerender unrelated consumers.
3. Define and test group/child effect precedence. Existing same-property effects overwrite earlier outputs rather than composing full ancestor transform stacks. This pivot change does not solve arbitrary nested composition.
4. Add representative large-drawing benchmarks for pointer responsiveness, snapshot updates, active animations and chart memory. Do not claim capacity from a successful build.
5. Require new custom shape props to have validators and migrations; require every new behavior to cover old-file defaults, undo/redo, duplicate, reload, driver replacement, disabled/offline behavior and group interaction. No per-frame persisted writes or per-shape station polling.

Validation: 21 isolated browser checks passed. The live in-app editor saved/reopened a left-edge pivot and Undo restored the original center. Typecheck and production build passed, with the existing large-chunk warning. No station was connected for this pass, so live station-driven rotation and high-load performance are not newly verified.

## Independent behaviors hardening, September 5

The first implementation slice prioritizes multiple points and animations on one shape without silent replacement. Library importing remains deferred.

| Before | After |
| --- | --- |
| Effect type doubled as identity; adding a second value replaced the first | Stable local behavior keys, owner-scoped runtime IDs, optional names and exact-ID edits |
| One label per shape | Independently configured labels grouped into non-overlapping side stacks |
| Multiple motions could overwrite earlier outputs | Explicit exclusive channels, separate X/Y movement and independently timed motion wrappers |
| Metadata edits rebuilt the binding list | Targeted shape writes preserving unsupported entries and unknown fields |
| Every collapsed behavior mounted an editor | Only the open editor mounts; label settings/rendering extracted into modules |

The typed catalog centralizes names, categories and conflict channels. It is not yet a complete plug-in system: defaults, validation and evaluation for non-label effects still need further extraction. Existing tldraw metadata/history remains the saved authority, following the SDK's [persistence guidance](https://tldraw.dev/sdk-features/persistence); the categorized inspector retains tldraw buttons and inputs following its [UI primitives](https://tldraw.dev/sdk-features/ui-primitives).

One enabled owner controls each exclusive channel. Imported/legacy duplicates resolve to the first enabled entry, with an inspector warning; newly created conflicts are rejected before any write. The nearest shape/group owner takes priority on inherited channels even when its point has no value. Different channels combine; ancestor transforms are not added together. Group fill overlays still use an assembled-group transform, so independently transformed descendants need a dedicated follow-up before claiming arbitrary nested-group composition.

Remaining work: extract other effect editors/validators, index runtime lookups and subscriptions, introduce a provider-neutral connection boundary when a second provider is actually scoped, and benchmark representative drawings. Unsupported effect/version payloads are preserved but this is not a complete future-version migration framework. New library assets will need validated/migrated shape props and explicit point-role remapping, not a second behavior runtime.

Verification for this slice: 32 isolated browser regression checks; synthetic UI checks for stacked values, independent driver changes, saved behavior names, concurrent rotation, and conflict rejection. No live station or large-load acceptance is implied. Production build/typecheck results are reported separately at handoff.

## Architecture assessment

The existing foundation fits the product. Keep React, tldraw and the loopback baskStream bridge. The useful separation is between a saved drawing and volatile station data. A framework rewrite would not address the concrete issues found here.

| Area | Responsibility | Assessment |
| --- | --- | --- |
| tldraw document | Shapes, groups, widget configuration and binding definitions | Now the single authority for saved canvas behavior. Native history and clipboard operations carry configuration. |
| `shapeBindings.ts` | Read bindings from metadata, migrate legacy records, dispatch edits | Small boundary between BAS terminology and tldraw storage. Binding identity follows the owning shape. |
| `useBasWorkspace.ts` | Connection, discovery, reads, subscriptions, history requests | Functional, but still combines too many transport and feature responsibilities. Split by connection, live values and history when these areas next grow. |
| Runtime wrapper and overlays | Present live label, fill and animation effects | Correctly avoids changing base artwork. The Live effects toggle suppresses presentation while arranging the saved geometry. |
| Table and trend shape utilities | Persisted widget props and runtime rendering | Appropriate tldraw extension point. ECharts supplies the plot; tldraw owns the shape and interaction state. |
| Niagara panel | Connection form, tree/search, point inspection and collection | Behavior editing has moved out. Further extraction of discovery and point collection remains useful when these grow. |
| Behavior inspector | Selected-shape effect list, point replacement and editable settings | Lives in the native style panel, with explicit Save/Cancel and shape-owned history. Station browsing is independent of editing. |
| Optional agent | Existing starter-kit agent and worker | Present but not a complete BAS authoring assistant. Custom widgets currently use the unknown-shape conversion path. |

## Findings addressed

| Finding | Change |
| --- | --- |
| Bindings lived in a separate local-storage document and did not follow native history or duplication. | Moved definitions into shape metadata, with one-time legacy migration and independent identities for copied shapes. |
| Deleted shapes could leave bindings and subscriptions behind. | Binding lists now derive from existing shapes; active subscriptions are scoped to the current page and station. |
| Identical point paths on different stations could drive the wrong artwork or widgets. | Runtime bindings and widget reads are gated by the connected station alias. An alias must still identify one station consistently. |
| Connection loss could leave old values and history visible. | Connection teardown clears runtime state. Late history and point responses from a previous connection are ignored. |
| A slower history response could overwrite a newer range request. | Per-series request identity admits only the latest response. |
| Canvas changes recreated point lists and could renew subscription groups needlessly. | Stable, sorted reference lists avoid updates when only selection or the camera changes. |
| Existing widgets had no direct settings surface. | Added table/chart settings inside the native style panel, using tldraw's input and button components. Titles, chart range, line mode, series colors, status visibility, point editing and refresh are accessible. |
| Tables could clip rows with no way to inspect them. | Double-click or Inspect enters table scrolling; Escape returns to canvas selection. Both widget types enforce useful minimum resize dimensions. |
| Chart time labels could imply that a short span of samples filled a much longer requested range. | The time axis follows the requested start/end. Empty samples remain gaps; empty strings are not converted to zero. A sample-cap hint is shown at 2,000 records. |
| The station tree exposed tree roles without arrow-key navigation or selection state. | Added arrow keys, Home/End, levels and selection semantics. Search limit and connected-session errors are visible. |
| Continuous animation only checked reduced motion when its effect started. | It now follows tldraw's reactive animation preference, including the system preference when no user override exists. |
| Custom shape accessibility names exposed internal tool identifiers. | Added translated widget names and shape titles. |
| Charts could retain light grid colors after switching to dark mode. | Chart colors are resolved after the shell and canvas theme updates finish. Rendered SVG strokes were checked against the active theme in both modes. |
| Animated artwork and native selection bounds could differ during editing. | A native Live effects toggle pauses runtime presentation while arranging artwork. Tables, charts and station subscriptions stay connected. |

The original `DESIGN.md` is a third-party description of tldraw's broader visual style, including marketing-page patterns. For editor controls, the installed SDK components and theme variables are the stronger authority. This pass follows those directly.

## Remaining work, in priority order

**Immediate priority: core authoring acceptance.** The user identified setup, panel layout and later edits as the immediate priority. The September 5 pass below addresses that flow. Refine it on real drawings before expanding the feature list.
1. **Runtime geometry acceptance.** Use Live effects paused while arranging artwork. With effects on, hit testing still follows saved geometry. A broader test matrix should cover nested groups, combined transforms and labels on every shape family before promising full parity.
2. **Widget export.** The custom HTML widgets do not yet implement `toSvg`. Native image export needs explicit table/chart rendering and a clear choice between a live snapshot and an offline representation. Saved drawing persistence is separate and supported.
3. **History completeness and units.** A request currently reads the first resolved history with a 2,000-record cap. Add history selection, units, quality flags, pagination or aggregation and mixed-unit axis rules. Refresh is manual; this is not an automatically rolling trend.
4. **Equipment mapping review.** Table row/column inference uses the path around `/points/`, or the immediate parent otherwise. An editable preview and conflict validation are now present. Nonstandard folder layouts still need broader real-drawing acceptance and eventually equipment templates.
5. **Module boundaries and startup weight.** Split connection/live/history hooks and the large Niagara panel. The client build is about 2.8 MB before compression and emits a chunk-size warning. Lazy-load chart rendering and optional agent surfaces after measuring startup impact.
6. **BAS-aware agent context.** Teach the optional agent about data widgets and binding actions through a deliberately bounded schema. Current presence of starter-kit code is not proof that these workflows work through chat.

These are recorded limitations and next steps, not completed features.

## Useful additions

| Priority | Addition | Concrete workflow | Relative effort |
| --- | --- | --- | --- |
| 1 | Equipment templates and point remapping | Build AHU_01 once, duplicate the assembly for AHU_02, choose its equipment root and confirm matching point roles. Preserve artwork, animation settings, chart colors and label placement. | Medium to large; benefits from the new shape-owned bindings and needs a mapping preview. |
| 2 | Binding health inspector | Find unresolved points, wrong station aliases and unsupported value types; select the affected shape and repair its reference. | Medium; reuses binding enumeration, point metadata and selection. |
| 3 | Better table mapping and comparison | Select several similar units, choose columns once, confirm each match, then sort or filter equipment by value or status. | Medium; build on the mapping preview rather than relying only on folder names. |
| 4 | Trend comparison tools | Compare command versus feedback or temperature versus setpoint with units, gaps, refresh and a shared time window. | Medium; history completeness should come first. |
| 5 | Reusable symbol assemblies | Save a configured fan, pump, damper or AHU group with named point roles. Insert it and connect those roles to equipment. | Medium to large; naturally follows templates. |
| Later | Vector PDF control drawings | Import vector pages, manually promote symbol paths into groups, then bind those groups. | Large; already scoped in the roadmap, with raster/scanned PDFs excluded. |

Updated next sequence: core editing acceptance on real drawings, including combined and grouped behaviors, before export completeness or equipment templates. Keep exploration flexible without letting feature expansion outrun the core workflow.

## Behavior-authoring follow-up, September 5

| Before | After |
| --- | --- |
| Point selection and behavior editing shared the station panel; browsing could implicitly replace a driver. | The left panel inspects points. The selected shape's native style panel lists its behaviors, with explicit Change point inside each editor. |
| Initial setup exposed an effect dropdown and mapping form together. | Add behavior starts with an effect, then a live-filtered point picker, then relevant settings. Existing effects open for editing instead of being overwritten. |
| Editing required a connected station. | Saved settings remain editable offline; only point selection/replacement needs a connection. |
| Advanced mapping dominated ordinary edits. | Common numeric ranges stay visible. Advanced mapping starts collapsed, and the current mapped result is visible. |
| A behavior had to be removed to stop it individually. | Enable switches retain configuration and keep point data available. Disabled effects are excluded from runtime presentation. |
| It was unclear whether a setting edit was saved. | Save/Cancel, unsaved-change feedback and numeric validation are explicit. Collapsing a row preserves its draft; Cancel restores the saved configuration. Selecting another shape discards unsaved drafts. |

New authoring components use tldraw's style panel, buttons, search input, theme variables and native document history. The UI-polish and React review checklists guided the compact control hierarchy and asynchronous response guards. Boolean motion defaults also recognize Niagara's textual `true`/`false` values.

That earlier panel pass kept the existing eight effect types and their advanced options. The independent-behaviors follow-up above now adds multiple instances with explicit conflict rules; bulk multi-selection editing, presets, publishing and deployment remain deferred.

Follow-up verification:

- TypeScript and production build pass; the existing large client-chunk warning remains.
- All ten isolated browser checks pass, including driver replacement with retained animation settings, disabled-state snapshot/undo, and runtime suppression.
- The existing station was connected read-only. A saved fan group exposed its existing rotation offline and then live. Replacing its point while editing timing preserved the draft; native undo restored the original point and 1.5-second timing.
- Browsing another point did not change that fan's driver. New boolean movement defaulted to Move while on; invalid zero-second timing blocked saving. Adding movement kept rotation intact, and undo removed the QA addition. The drawing retains its original five behaviors, with the fan enabled.
- Collapsing and reopening an edited row retained its unsaved timing; Cancel restored the saved value. Light and dark panel appearances were inspected, then light mode was restored.
- A clean reload retained all five behaviors. Offline editing and reconnect were checked again. Pausing live effects retained the open draft, and the final browser log had no new errors after reload (earlier hot-refresh hook errors occurred while the source was being edited).

## References

- [tldraw shapes and metadata](https://tldraw.dev/docs/shapes): custom shape utilities, metadata persistence and shape behavior.
- [tldraw history](https://tldraw.dev/sdk-features/history): store changes, undo stopping points and history-ignored initialization.
- [tldraw UI primitives](https://tldraw.dev/sdk-features/ui-primitives): native inputs, buttons and control composition.
- [tldraw interactive shapes](https://tldraw.dev/examples/interactive-shape): custom HTML interaction and event handling.
- [tldraw persistence](https://tldraw.dev/docs/persistence): snapshots and schema evolution.

The installed tldraw 5.4 source was checked alongside these references for the actual API signatures.

## September 4 baseline verification

- TypeScript and production builds pass. The existing large client-chunk warning remains.
- Seven isolated checks pass in the in-app browser: migration, edit undo/redo, independent duplication, deletion/restoration, migration idempotence after removal, snapshot reload and clipboard metadata.
- The existing station was connected read-only. The equipment table showed live values and the trend loaded actual history with the corrected requested time window.
- In-app browser checks confirmed editing an existing chart, saving its title, native undo restoring the original title, chart/table inspection and Escape exit, tree keyboard focus, and the Live effects toggle while table values continued updating.
- Light and dark appearances were inspected. The chart's SVG grid stroke matched the active tldraw divider token in both themes. Light mode and live effects were restored after testing.
- The browser reported no captured runtime errors during the final check.
- The isolated fixture has no persistence key or station access. Legacy binding browser records remain untouched as a fallback.
