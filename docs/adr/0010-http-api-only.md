# HTTP API only: the MCP adapter is removed

Status: accepted

docspawner had two inbound adapters: HTTP (Fastify) and an MCP server for AI agents. We removed the MCP adapter and keep only the HTTP API. This keeps the scope small: one entry point to document (OpenAPI), test, deploy, and explain.

Agents can still use docspawner: any agent that can make an HTTP request can call `POST /render`. The `422` response returns the same structured diagnostics, with line, column, and hints.

The core does not change. An MCP adapter can be added again later as a new package that calls `RenderDocument`, with no change to the core or the HTTP adapter (ADR-0004).
