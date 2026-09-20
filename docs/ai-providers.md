# AI providers

Basdraw uses the tldraw Agent Starter Kit architecture already present in `client/`, `shared` and `worker`. The canvas agent can inspect structured shapes and the visible canvas, stream typed actions, modify the drawing and receive enabled project and connection knowledge selected by the Worker.

The agent can also call tools published by an enabled, connected data adapter. The first adapter is Niagara via baskStream, with bounded station browse, point search, and current-value reads. Tool results return in a follow-up agent turn, so the same request can discover station data and then create or revise canvas content from that result.

This is a protocol-neutral boundary. Each future connection adapter may publish a different set of tools and input contracts; the agent does not assume every connection behaves like baskStream. Only redacted tool metadata and the requested result enter model context. Connection credentials and authenticated clients remain in the local connection runtime.

## ChatGPT subscription connection

Local basdraw uses Codex App Server as its primary model connection. This is the supported Codex integration surface for products that need authentication, conversations, approvals and streamed events. Codex supports managed ChatGPT login, including the usage supplied by an eligible ChatGPT subscription.

Run `codex login` once, then use `npm run dev`. The development launcher starts `scripts/codex-subscription-bridge.mjs`, which:

- runs `codex app-server` over its local stdio protocol
- reads only account type, plan type, available models and their supported reasoning efforts for status
- sends the tldraw system prompt, canvas context and structured-output schema for an agent turn
- streams only assistant-message deltas back to the tldraw agent
- creates ephemeral threads in an empty temporary working directory
- uses a read-only sandbox and an approval policy of `never`
- disables shell, web search, apps, plugins, MCP servers and multi-agent tools for the embedded process
- listens only on `127.0.0.1:8791` and requires the private basdraw request header

ChatGPT authentication tokens remain managed by Codex. They are never returned by the bridge or stored in the browser, tldraw document, knowledge database or Niagara connection profile.

The app exposes a managed ChatGPT sign-in button if Codex is installed but not authenticated. Once connected, the native-style Canvas AI composer offers the models and reasoning levels reported by Codex. Both selections persist locally and are applied to each new turn.

## What this does not mean

Basdraw is not calling the normal OpenAI API through a ChatGPT subscription. It is integrating the local Codex client through Codex App Server, which officially supports ChatGPT-managed authentication. The available models and usage limits therefore follow the signed-in ChatGPT workspace and Codex plan.

This connection is intentionally local. A remotely hosted basdraw server cannot silently reuse a visitor's local ChatGPT session. A future hosted or desktop release would need an authenticated local companion, a packaged desktop process or another officially supported per-user Codex connection.

## Optional API providers

The inherited starter architecture still contains OpenAI, Anthropic and Google API adapters. They remain optional and are not required for the local subscription path. If used, their keys must remain in the Worker environment and must never be compiled into the frontend or saved in canvas persistence.

Provider connections remain independent from tldraw document storage, the AI knowledge database and Niagara connection packages. This prevents a canvas file from becoming a secret container and keeps future model connections replaceable.
