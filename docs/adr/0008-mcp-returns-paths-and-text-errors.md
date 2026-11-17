# MCP tools write the PDF to disk and return text errors

Status: deprecated. The MCP adapter was removed (ADR-0010).

`render_document` writes the PDF to a file and returns its path. It does not return the PDF as base64. Agents such as opencode work with files, and a base64 PDF wastes the agent's context.

On failure, the tool returns `isError: true` with plain text: `error at main.typ:3:8: unknown variable: x` plus Typst's hints. An agent can read this, fix the template, and call the tool again. This loop is the main reason to offer MCP.

`output_path` must end in `.pdf`, so an agent cannot use the tool to write other file types.
