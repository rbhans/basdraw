# AI skills and project knowledge

Basdraw separates executable connection tools, plugin instructions and project knowledge. Both ChatGPT subscription and API providers receive the same catalog and use the same knowledge action.

## Ownership

- Connection adapters own authentication, protocol details, live capabilities and tools. Different connection types can expose entirely different operations.
- Plugins ship versioned skills and references through `shared/knowledge/bundles.ts`. Client descriptors and the Worker share that installation catalog. Bundles declare ownership and optional applicable connection types. IDs are stable; duplicate entries and missing reference dependencies fail registration. The built-in canvas skill explains how native tldraw actions and enabled plugin capabilities compose; feature plugins contribute focused behavior, data-widget, relationship, PDF and web-view references.
- D1 stores editable global, project and connection entries. `KnowledgeService` depends only on `catalog`, `search` and `getScoped`, allowing a different storage implementation without changing model providers or connections.

Never store connection credentials, live point snapshots, canvas geometry or a copy of a station database as knowledge.

## Progressive loading

The initial prompt includes only metadata: IDs, titles, descriptions, scopes and plugin versions/reference IDs. Catalog pages contain up to 40 entries and approximately 12,000 metadata characters, with `nextOffset` when more exist.

The agent's `knowledge` action supports:

- `catalog`: browse subsequent metadata pages using `offset`.
- `loadSkill`: read the relevant workflow before following it.
- `getReference`: read a document, following `nextOffset` for additional pages.
- `search`: find scoped entries by keywords, optionally `projectOnly: true`. All search terms must match. Results include short excerpts and IDs. This is text search, not semantic/vector retrieval.

Results use the starter kit's existing action continuation. The four most recently loaded pages remain selected across follow-up actions, bounded to 48,000 content characters. The Worker re-reads and scope-checks each selected page on every request, so edits and disabling take effect without a restart. A new chat or project/connection/plugin scope clears the selection. Interrupted requests cannot attach late results to a new request.

Skills should stay under 12,000 characters, with longer supporting material stored as references. References support 100,000 characters and pages of 12,000 characters. Evicted pages can be loaded again. Storage failures are explicit; bundled skills remain usable when D1 is unavailable.

Knowledge is context, not authorization. Current tool descriptions determine available operations. Project text cannot enable tools, override the user's request or bypass existing station write restrictions.

The catalog is automatically scoped to enabled plugins and supplied to every configured model provider. Skill bodies are not blindly appended to every turn: the agent receives their metadata, loads a relevant skill with the generic knowledge action, and retains the bounded loaded page across dependent follow-up actions. This keeps future plugin additions discoverable without permanently filling the context window.

## Project UI and persistence

Open **Add-ons → AI & references → Project knowledge** to create/edit notes, references and procedures. Disable entries without deleting them. The editor uses tldraw's dialog layer, controls and theme tokens.

`document.meta.basdrawProjectId` associates the canvas with its knowledge and travels with the normal tldraw document. Existing canvases adopt `bas-whiteboard-canvas-v1` on upgrade to preserve prior knowledge. Subsequently opened documents without an identity receive a new one; documents carrying an identity retain it. Advanced **Project identity** settings associate canvases with shared or separate projects without moving or deleting entries.

The existing browser persistence key is unchanged. Canvas saves contain the identity, not the external knowledge entries. Back up `.wrangler/` separately for local knowledge. Automatic PDF text extraction, document relationship indexing and knowledge export inside canvas files are not implemented here. Project content currently enters through text editing or the API.

## Connection scope

Adapters expose redacted `knowledgeScopeIds` for connection-instance references, defaulting to the adapter ID. baskStream uses its station alias for compatibility. All connected adapters contribute scopes regardless of protocol. A disconnected adapter's type can still expose its setup instructions, but only connected instances contribute connection-specific knowledge.

Disabled plugins are excluded from catalog, search and direct ID retrieval. Bundled IDs are reserved by their plugin. The old baskStream database seed is preserved but superseded by its plugin bundle, and cannot resurrect a disabled skill.

## Local setup and API

Run `npm run knowledge:migrate`, then `npm run dev`. Wrangler stores local SQLite-backed D1 data under the Git-ignored `.wrangler/` directory.

Available endpoints:

- `GET /api/knowledge`: administrative list with kind, scopeType, scopeId and enabled filters.
- `GET /api/knowledge/context`: preview metadata catalog; accepts projectId, pluginIds, connectionIds and connectionTypes.
- `GET /api/knowledge/:id`: administrative full entry.
- `POST /api/knowledge/retrieve`: scoped agent retrieval, accepting `{ scope, request }`.
- `POST /api/knowledge`, `PATCH /api/knowledge/:id`, `DELETE /api/knowledge/:id`: administration.

Retrieval scope includes projectId, connectionId (legacy), connectionIds, connectionTypes and enabled pluginIds. The app supplies it independently of model arguments.

This remains a local single-user app. Scope filtering is not a multi-user authorization system; hosted ownership/access would need authenticated server-side scope resolution. Local endpoints accept same-origin requests or command-line requests without a token. Existing remote policy requires KNOWLEDGE_ADMIN_TOKEN; the UI does not implement remote login. No remote database or deployment is created.

## Adding a plugin skill

Create a typed PluginKnowledgeBundle with a pluginId, version, optional connectionTypes and entries. Each entry has a stable id, kind, title, description and content; skills can list referenceIds from their bundle. Register it in shared/knowledge/bundles.ts. Keep API specifics in that plugin's references and tools, and project conventions in the project store.

## Verification

`npm test` covers database isolation, direct reads, search, pagination, bundle ownership, legacy seeds, outages and context lifecycle. Build/typecheck cover integration.

The optional `scripts/knowledge-live-smoke.mjs` uses the existing subscription connection with synthetic text. Set BASDRAW_SMOKE_PROJECT to a project containing a temporary verification reference with label QA-AHU-42. It sends no drawing, credentials or station data and executes only knowledge reads. It is excluded from default tests.

Strict structured-output compatibility is handled at the provider boundary: optional fields become nullable required fields, and open argument maps travel as JSON-encoded strings. Responses are restored and validated against the original SDK action schemas before completed actions reach the client. Other providers continue to use the SDK representation.
