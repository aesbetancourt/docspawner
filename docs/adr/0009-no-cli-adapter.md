# No CLI adapter

Status: accepted

We planned a docspawner CLI and then removed it. A developer with Typst installed can already run `typst compile`, so a CLI adds almost nothing. docspawner adds value when the caller is another service, another language, or an agent. Those callers use the HTTP API.

Other items out of scope by design: template storage (ADR-0002), auth, a live editor, async jobs, and multi-file templates.
