# Basdraw plugin architecture

Basdraw's custom features are installed through `client/plugins/builtinPlugins.tsx`. A plugin is a typed descriptor, not a second application shell. The registry assembles each contribution into the existing tldraw editor.

Every descriptor declares a category (`id`, `label`, `order`). Add-ons lists categories first and expands one category at a time, with the existing per-plugin preferences inside. Mandatory core features are omitted from this optional-tools menu. Reuse the same category metadata when adding tools; the registry rejects conflicting labels/orders. Category grouping does not change saved plugin IDs or canvas compatibility.

Shell controls retain the editor's React context through portals. `ShellUiContainer` routes menus and dialogs to the shared viewport-sized UI layer, above the canvas, points panel and AI dock. New popup controls should use SDK primitives within that container instead of local absolutely positioned popovers. Canvas toolbar wrapping uses the available canvas width, including when AI is open.

## Installed and enabled are different

All installed tldraw shape utilities, binding utilities, state-node tools and overlay utilities are registered when the editor starts. They remain registered when a plugin is disabled so a saved canvas never loses the code required to read its existing records.

Enablement controls the active capability instead:

- toolbar commands
- BAS property sections
- runtime shape decorators and canvas overlays
- React providers and application panels
- editor mount behavior
- connection runtime
- agent availability

The Add-ons menu stores only explicit user overrides. A newly installed plugin can therefore use its own `defaultEnabled` value without migrating every user's preferences. Enabling a plugin also enables its declared dependencies. Core compatibility plugins can use `alwaysEnabled`.

## Contribution surfaces

`BasdrawPlugin` currently supports:

- tldraw shape, binding, tool and overlay registrations
- translated tldraw UI tools
- grouped bottom-toolbar commands
- shape property sections
- shape decorators for live presentation
- overlays placed in front of the canvas
- application-level providers and left or right panels
- agent action, prompt-part and reference declarations
- model-facing canvas capabilities with plugin-owned inspection, validation and execution
- versioned knowledge bundles with skills, references and connection-type applicability
- connection capability and reference declarations
- editor mount setup and cleanup

Toolbar grouping is presentation, not ownership. For example, Vector PDF and Web View are independent plugins that both contribute commands to `Import & embed`.

## Connection adapters and AI

Connection plugins expose model-facing operations through `ConnectionRuntime`, not through baskStream-specific agent code. An enabled plugin registers an adapter from one of its provider contributions. The adapter supplies:

- a stable connection ID and protocol type
- current connected state and advertised capabilities
- its own named tools, input descriptions, and read/write classification
- runtime executors that retain authentication and protocol details inside the connection layer
- stable redacted knowledge scope IDs for connection-instance references

The agent receives only the redacted adapter/tool descriptions. It calls the generic `connectionTool` action, and the adapter result returns through the agent's normal bounded data continuation. Credentials, cookies, endpoints, client instances, and complete station data are not included in model context.

Plugin knowledge lives in a shared versioned bundle registered in `shared/knowledge/bundles.ts`. Client descriptors and the Worker use the same installation catalog. Bundles can declare their own connection types without imposing shared BAS operations. The Worker supplies metadata first, then scoped content on demand. Project entries remain independently editable. See [AI skills and project knowledge](knowledge-backend.md) for retrieval, persistence and extension details.

The built-in baskStream adapter currently exposes bounded `browse`, `search`, and batch `read` tools. Another connection can expose a different tool set without pretending to support baskStream operations. Any adapter may declare a write tool, but the runtime only exposes it in Full control and pauses for an **Allow once** confirmation immediately before execution. The adapter's declared effect is checked again at execution time. Future high-impact tools can add richer preview and post-write verification without changing read tools or canvas capabilities.

## Agent canvas capabilities

Plugins add native model operations through `agent.canvasCapabilities`. Each capability owns a stable plugin-scoped ID, supported operations, a model-facing argument contract, optional shape inspection and a runtime executor. The core agent uses one generic `pluginContent` action, so adding a new symbol library or domain widget does not expand the shared response schema.

The runtime only installs capabilities from enabled plugins, rejects undeclared operations, rechecks read-only state and delegates validation to the owner. Existing custom shapes appear in focused canvas context with subtype, name, bounds, rotation and bounded props. They are descriptive, not an implicit creation schema. Tables, trends, web views, live behaviors and relationship arrows use this boundary now.

## Access profiles

User-facing profiles are presets over three independent policy axes: `ai: off | analyze | act`, `canvas: read | write`, and `connections: none | read | write`.

- **Full control**: AI may edit the canvas and use read/write connection tools. Every connection write still requires one-time confirmation.
- **Canvas control**: AI may inspect and edit the canvas; no connection tools enter model context.
- **Analysis**: AI may inspect the canvas and use read-only connection tools; the editor and canvas action runtime are read-only.
- **View only**: the editor is read-only and Canvas AI is off. Existing live data can still display.

Action metadata declares its access class. Missing metadata fails closed as a canvas write. Changing profiles cancels an active agent request so an already-streaming action cannot retain the previous profile.

## Compatibility rules

1. A plugin ID is permanent and uses lowercase kebab case.
2. Versions use semantic versioning.
3. Saved shape and binding schemas own their migrations through their tldraw utilities.
4. Disabling a plugin hides its authoring and runtime capability but does not unregister saved record types.
5. Contribution IDs are globally unique. The registry fails early on duplicate plugin, UI, property, overlay, provider, panel or tldraw registration IDs.
6. Canvas records, saved connection profiles and volatile station values remain separate. A plugin must not put credentials or live snapshots into the canvas.
7. A connection plugin declares the operations it can perform. Agent tools must check the live connection's advertised capability before being offered or executed.
8. Destructive or operational AI actions need a preview and explicit confirmation boundary even if the connection API supports the operation.

## Adding a built-in plugin

1. Define the feature behind a `BasdrawPlugin` descriptor in `builtinPlugins.tsx` or a focused module imported there.
2. Give the plugin only the contribution surfaces it owns. Do not edit `App.tsx`, `DataToolbar.tsx` or `DataShapeStylePanel.tsx` for normal feature registration.
3. Add tldraw record migrations before changing any saved schema.
4. Declare dependencies on other plugin IDs rather than importing their UI.
5. Add connection or agent declarations when the feature exposes data or model actions.
6. Verify the feature enabled, disabled, and with an existing saved canvas that contains its records.

## Current and planned extension points

The next plugins can use this base without becoming mandatory core features:

- the optional Canvas relationships plugin connects existing items with native bound tldraw arrows and lightweight metadata
- BAS system and network-map tools
- additional symbol libraries
- additional station or protocol connection adapters
- canvas-aware AI references and station actions

Relationship arrows attach to ordinary existing canvas items and remain editable through native tldraw behavior. A special node type remains appropriate only when a future plugin intentionally introduces a system-map node, not merely to express a relationship between two documents or shapes. Relationship metadata is explanatory canvas structure and never implies a Niagara wire or command.
