# CLAUDE.md

Project context for AI coding agents working on this codebase.

## Project overview

docspawner is a stateless HTTP worker. A caller sends a Typst template and JSON data to `POST /render` and gets a PDF back. The worker stores nothing.

It uses **hexagonal architecture** (ports and adapters) with the standard layout from Tom Hombergs, _Get Your Hands Dirty on Clean Architecture_. Read [ADR-0004](docs/adr/0004-ports-and-adapters.md) before you add or move a file. Every decision record is in `docs/adr/`.

## Tech stack

- **Runtime:** Node.js 24
- **Framework:** Fastify 5, with `@fastify/swagger` and `@fastify/swagger-ui` (OpenAPI 3.1)
- **Language:** TypeScript 7 (native Go compiler; strict mode, `exactOptionalPropertyTypes`, `NodeNext` module resolution)
- **Renderer:** the Typst CLI, pinned to 0.15.1 in the Docker image
- **Validation:** JSON Schema for the request shape at the HTTP edge, plain TypeScript for the core's rules (ADR-0013), Zod for environment variables
- **Testing:** Vitest, with `app.inject()` for HTTP tests and the real Typst binary for adapter tests
- **Linting:** oxlint with type-aware rules (`oxlint-tsgolint`)
- **Formatting:** oxfmt
- **Dead code:** Knip

## Architecture

One rule organizes the folders: **`in` means someone calls us. `out` means we call someone.**

| Folder                         | Role                                                        | May import                               |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------- |
| `src/domain/`                  | The data: request, result, errors, limits, domain constants | `domain` only                            |
| `src/application/port/in/`     | What the worker offers (`RenderDocument`)                   | `domain`, `port`                         |
| `src/application/port/out/`    | What the worker needs (`TypstCompiler`, `Clock`)            | `domain`, `port`                         |
| `src/application/service/`     | The logic, with no I/O                                      | `domain`, `port`, `service`              |
| `src/adapter/in/http/`         | Fastify routes, schemas, Swagger                            | `domain`, `port`, `adapter`, any package |
| `src/adapter/out/`             | Typst CLI, system clock                                     | `domain`, `port`, `adapter`, any package |
| `src/config.ts`, `src/main.ts` | Startup: settings and the only composition root             | anything                                 |

`test/architecture.test.ts` checks this table on every import in `src/`. When it fails, move the code to the right layer. The rule itself changes only with a new ADR.

To place new code, ask in order: is it data (`domain`), an interface the core owns (`port`), logic without I/O (`service`), or a connection to a technology (`adapter`)?

Expected failures are values, not exceptions: return `{ ok: false, error }` with a kind from `RENDER_ERROR_KIND`. Throw only for real faults, such as a missing Typst binary.

## Code style rules

- **`if`/`else` or a small helper function** in place of the ternary operator
- **Fix the root cause of a lint error.** Lint-suppression comments (`eslint-disable`, `oxlint-disable`) fail `pnpm lint`.
- **JSDoc on all exported functions and public methods**, with `@param`, `@returns`, and `@throws` where they apply
- **Comments explain "why", not "what".** The code says what.
- **`as const`** on schema objects and on constant objects, for type inference
- **Named constants for domain strings.** Use `as const` objects such as `RENDER_ERROR_KIND`, `COMPILE_OUTCOME`, `DIAGNOSTIC_SEVERITY`, and `LIMITED_FIELD` in `src/`. Tests may use literal values, because they check the public contract.
- **Cognitive complexity ≤ 15** per function. Split complex logic into small helpers. Lint enforces cyclomatic complexity ≤ 15.
- **At most 7 parameters.** Bundle 4 or more related arguments into one typed object (`params: Readonly<Params>`).
- **Optional chaining and early return** to keep branches flat: `a?.b === "c"`, not `a && a.b === "c"`
- **One body per branch.** Combine conditions or extract a helper when two branches do the same thing.
- **No wide `string` in literal unions.** Write `"a" | "b"`, not `"a" | "b" | string`.
- **No `| undefined` on optional properties.** Write `version?: number`, not `version?: number | undefined`.
- **`toHaveLength(n)`** in tests, not `expect(arr.length).toBe(n)`
- **Type guards or `JSON.parse`**, not unsafe type assertions (`as Error`, `as unknown as T`)
- **English only** in code, messages, logs, and docs

## Testing

- HTTP tests use `app.inject()`: no real network.
- Service tests use fakes for `TypstCompiler` and `Clock`. They need no Typst binary.
- Adapter and example tests run the real `typst` binary. Install Typst 0.15.1 before you run `pnpm test`.
- `test/examples.test.ts` renders every folder in `examples/`. Each must render twice with no warnings and the same bytes.
- `test/support/real-renderer.ts` wires the real service for tests, in the same way as `main.ts` but without HTTP.

## Verification

```bash
pnpm check   # format:check, lint, knip, typecheck, test:coverage, openapi:check
```

All checks must pass before a change is complete.

## Common tasks

### Changing the HTTP API

1. Change the schema in `src/adapter/in/http/schemas.ts` and the route in `app.ts`.
2. Add or change the test in `test/adapter/in/http/app.test.ts`.
3. Run `pnpm openapi` to regenerate `docs/openapi.json`.
4. Update the API section of `README.md`.

### Adding an error kind

1. Add it to `RENDER_ERROR_KIND` and `RenderError` in `src/domain/render.ts`.
2. Add its status code to `STATUS_BY_ERROR` in `src/adapter/in/http/app.ts`. TypeScript fails until you do.
3. Add its response schema in `schemas.ts`.

### Changing a limit

Edit `DEFAULT_LIMITS` in `src/domain/render.ts`. The API schema and the OpenAPI document read the limits from there. `BODY_LIMIT_BYTES` in `schemas.ts` must stay larger than `maxTemplateBytes + maxDataBytes`. If it does not, Fastify returns `413` before the core sees the request.

### Adding a configuration variable

1. Add it to the Zod schema and `ServerConfig` in `src/config.ts`.
2. Add a test in `test/config.test.ts`.
3. Add it to the Configuration table in `README.md`, and to `docker-compose.yml` if the container needs it.

### Adding a Typst package

1. Add `#import "@preview/<name>:<exact version>"` to `typst-packages/allowlist.typ`.
2. Run `pnpm packages`. The Docker build installs the same allowlist.
3. Add the package to the table in ADR-0012 and in the README.

### Adding an example

Create `examples/<name>/template.typ` and `examples/<name>/data.json`. `test/examples.test.ts` picks it up. Run `pnpm examples <name>` against a running worker to save the PDF, and `pnpm previews` to render the page images. Add a section to Examples in `README.md`.

## Typst gotchas

- Templates may import only the packages in `typst-packages/allowlist.typ` (ADR-0012). The worker blocks every download at render time. Run `pnpm packages` after a fresh clone; `pnpm test` runs it first.
- In markup, a `#let` line ends at the newline. Wrap a multi-line expression in `{ }`.
- Typst prints 0-based columns. `typst-diagnostics.ts` converts them to 1-based.
- System fonts are ignored for deterministic output. Only fonts embedded in Typst and the folders in `DOCSPAWNER_FONT_PATHS` are available.
- `pnpm bench` and `pnpm openapi` import from `dist/`. They run `pnpm build` first. `pnpm examples` sends HTTP requests to a running worker.
