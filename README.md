# docspawner

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Turn a Typst template and JSON data into a PDF with one HTTP call.**

docspawner is a stateless PDF rendering worker. Your service sends the template and the data. docspawner returns the PDF, or an error that says exactly what to fix. It stores nothing, so you can run as many copies as you need.

- **Fast:** about 100 ms for a 3-page invoice with a chart and a payment QR code. No headless browser.
- **Predictable:** the same template, data, and timestamp give the same PDF bytes.
- **Safe for untrusted templates:** compile timeout, size limits, an isolated folder per render, no network access.
- **Clear errors:** compile errors come with line, column, and Typst's hints.
- **Built as a worker:** a fixed number of render slots, a bounded queue, `503` with `Retry-After` when full, and graceful shutdown.
- **Documented:** OpenAPI 3.1 and Swagger UI at `/docs`.

## Quick start

With Docker (Typst is included in the image):

```sh
docker compose up --build -d
curl -s localhost:3000/health
# {"status":"ok","typstVersion":"0.15.1","renders":{"active":0,"queued":0,"maxConcurrent":1,"maxQueued":100}}
```

Render a PDF:

```sh
curl -s localhost:3000/render \
  -H 'content-type: application/json' \
  -d '{"template": "#let data = json(\"data.json\")\n= Hello #data.name", "data": {"name": "Ana"}}' \
  -o hello.pdf
```

Or render every example and see the metrics (needs `jq`):

```sh
pnpm examples
```

```text
Document                  Pages     Size Worker ms (min/avg/max) Round trip  Warn  SHA-256
batch-release-dossier         5   210 KB      553 / 560 / 566     562 ms     0  3b31a55767fa
certificate-of-analysis       2   148 KB      325 / 326 / 328     328 ms     0  4c04770c6b24
cold-chain-shipment           2    80 KB      238 / 253 / 285     255 ms     0  d7e9b4c77b7a
invoice                       3   101 KB      117 / 118 / 120     120 ms     0  3e142366f93d

Invoice under load: 20 requests from 4 parallel clients
  Throughput   8.0 invoices/s · 24.0 pages/s · 2.5 s for the batch
  Round trip   p50 482 ms · p95 515 ms · max 523 ms
  Worker       peak 1 of 1 slots busy · peak 3 queued
  Results      20 of 20 ok
```

Then open the API documentation at <http://localhost:3000/docs>.

## Template contract

The template reads its data from the file `data.json`. This is the only rule.

```typst
#let data = json("data.json")
= Invoice #data.number
Customer: #data.customer
```

| Available in a template                                                                                                        | Not available                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| All Typst markup and scripting                                                                                                 | Images and other files (one template file only)         |
| Fonts embedded in Typst: Libertinus Serif, New Computer Modern, DejaVu Sans Mono                                               | System fonts, unless added with `DOCSPAWNER_FONT_PATHS` |
| `datetime.today()`, set by `options.timestamp`                                                                                 | Packages outside the allowlist                          |
| Packages in [`typst-packages/allowlist.typ`](typst-packages/allowlist.typ): `alchemist`, `lilaq`, `fletcher`, `tiaoma`, `zero` | Package downloads while rendering                       |

## Examples

Each example is a folder with `template.typ` and `data.json`: exactly what you send to `POST /render`. The rendered PDF is next to them. A test renders every example with the real Typst binary and checks that two renders give the same bytes.

The times are the mean time in the worker, measured with `pnpm examples -n 3` against the Docker image (1 CPU, 1 render slot). Click a page to open the PDF.

### Batch release dossier

**5 pages · 210 KB · 560 ms** · [PDF](examples/batch-release-dossier/batch-release-dossier.pdf) · [template and data](examples/batch-release-dossier/)

<p>
  <a href="examples/batch-release-dossier/batch-release-dossier.pdf"><img src="docs/images/examples/batch-release-dossier-1.png" alt="Batch release dossier, page 1" width="150"></a>
  <a href="examples/batch-release-dossier/batch-release-dossier.pdf"><img src="docs/images/examples/batch-release-dossier-2.png" alt="Batch release dossier, page 2" width="150"></a>
  <a href="examples/batch-release-dossier/batch-release-dossier.pdf"><img src="docs/images/examples/batch-release-dossier-3.png" alt="Batch release dossier, page 3" width="150"></a>
  <a href="examples/batch-release-dossier/batch-release-dossier.pdf"><img src="docs/images/examples/batch-release-dossier-4.png" alt="Batch release dossier, page 4" width="150"></a>
  <a href="examples/batch-release-dossier/batch-release-dossier.pdf"><img src="docs/images/examples/batch-release-dossier-5.png" alt="Batch release dossier, page 5" width="150"></a>
</p>

A pharmaceutical batch release dossier: GS1 DataMatrix and QR codes (`tiaoma`), the ibuprofen skeletal formula (`alchemist`), a process-flow diagram (`fletcher`), and charts with error bars, fitted lines and a heat map (`lilaq`). The template computes the content-uniformity acceptance value, the dissolution f2 factor, the stability regression, and the GS1 check digits.

### Certificate of Analysis

**2 pages · 148 KB · 326 ms** · [PDF](examples/certificate-of-analysis/certificate-of-analysis.pdf) · [template and data](examples/certificate-of-analysis/)

<p>
  <a href="examples/certificate-of-analysis/certificate-of-analysis.pdf"><img src="docs/images/examples/certificate-of-analysis-1.png" alt="Certificate of Analysis, page 1" width="150"></a>
  <a href="examples/certificate-of-analysis/certificate-of-analysis.pdf"><img src="docs/images/examples/certificate-of-analysis-2.png" alt="Certificate of Analysis, page 2" width="150"></a>
</p>

A pharmaceutical Certificate of Analysis: the paracetamol structure (`alchemist`), an HPLC chromatogram computed from peak data and a 12-vessel dissolution chart (`lilaq`), assay replicates with RSD, test results with pass/fail, and GS1 DataMatrix and verification QR codes (`tiaoma`).

### Cold-chain shipment report

**2 pages · 80 KB · 253 ms** · [PDF](examples/cold-chain-shipment/cold-chain-shipment.pdf) · [template and data](examples/cold-chain-shipment/)

<p>
  <a href="examples/cold-chain-shipment/cold-chain-shipment.pdf"><img src="docs/images/examples/cold-chain-shipment-1.png" alt="Cold-chain shipment report, page 1" width="150"></a>
  <a href="examples/cold-chain-shipment/cold-chain-shipment.pdf"><img src="docs/images/examples/cold-chain-shipment-2.png" alt="Cold-chain shipment report, page 2" width="150"></a>
</p>

A cold-chain report for vaccines and insulin: the route with temperatures per leg (`fletcher`), a 3-sensor temperature chart and a histogram (`lilaq`), the mean kinetic temperature per sensor, SSCC pallet barcodes (`tiaoma`), and a release decision that switches to quarantine if any reading leaves 2–8 °C.

### Invoice

**3 pages · 101 KB · 118 ms** · [PDF](examples/invoice/invoice.pdf) · [template and data](examples/invoice/)

<p>
  <a href="examples/invoice/invoice.pdf"><img src="docs/images/examples/invoice-1.png" alt="Invoice, page 1" width="150"></a>
  <a href="examples/invoice/invoice.pdf"><img src="docs/images/examples/invoice-2.png" alt="Invoice, page 2" width="150"></a>
  <a href="examples/invoice/invoice.pdf"><img src="docs/images/examples/invoice-3.png" alt="Invoice, page 3" width="150"></a>
</p>

An invoice with 42 items: line items grouped by category with subtotals, VAT per rate, due and early-payment dates, a spend chart (`lilaq`), and a SEPA payment QR code (EPC GiroCode, `tiaoma`).

### Render the examples and see the metrics

Run `pnpm examples [-n RUNS] [-l REQUESTS] [-c CLIENTS] [example ...]` against a running worker. It runs `examples/render.sh`. With no example, it renders all of them. It saves each PDF in the example's folder, for example `examples/invoice/invoice.pdf`. After you change an example, run it again, and run `pnpm previews` to render the page images in `docs/images/examples/`. For each document, it reports pages, size, the time in the worker (`x-render-duration-ms`), the round trip, warnings, and a SHA-256 prefix. When the invoice is selected, it also sends `REQUESTS` invoices (default 20) from `CLIENTS` parallel clients (default 4). It then reports throughput, p50 and p95 latency, and the peak use of render slots and the queue from `/health`. The script exits with `1` if a render fails. Set `DOCSPAWNER_URL` when the worker is not at `http://127.0.0.1:3000`.

## API

### `POST /render`

```json
{
  "template": "#let data = json(\"data.json\")\n= Hello #data.name",
  "data": { "name": "Ana" },
  "options": { "timestamp": 1763251200, "timeoutMs": 5000 }
}
```

| Field               | Required | Description                                                       |
| ------------------- | -------- | ----------------------------------------------------------------- |
| `template`          | Yes      | Full Typst source, max 1 MB                                       |
| `data`              | Yes      | Any JSON value, max 5 MB. The template reads it as `data.json`.   |
| `options.timestamp` | No       | Document date as UNIX seconds. Send it for byte-identical output. |
| `options.timeoutMs` | No       | Compile time limit, from 1 to 60000. Default: 10000.              |

| Status | Meaning                    | Body                                                                         |
| ------ | -------------------------- | ---------------------------------------------------------------------------- |
| `200`  | PDF rendered               | `application/pdf`, sent as `document.pdf`                                    |
| `400`  | Invalid request            | `{ "error": { "kind": "invalid_input", "message" } }`                        |
| `408`  | Compile took too long      | `{ "error": { "kind": "timeout", "timeoutMs" } }`                            |
| `413`  | Template or data too large | `{ "error": { "kind": "input_too_large", ... } }`                            |
| `415`  | Body is not JSON           | `{ "error": { "kind": "invalid_input", "message" } }`                        |
| `422`  | Template does not compile  | `{ "error": { "kind": "compile_failed", "diagnostics": [...] } }`            |
| `503`  | Worker at capacity         | `{ "error": { "kind": "busy", "retryAfterSeconds" } }`, `Retry-After` header |
| `404`  | Unknown route              | `{ "error": { "kind": "not_found", "message" } }`                            |
| `500`  | Unexpected server error    | `{ "error": { "kind": "internal", "message" } }`, no details                 |

A misspelled field (`#data.nmae` instead of `#data.name`) returns `422`:

```json
{
  "error": {
    "kind": "compile_failed",
    "diagnostics": [
      {
        "severity": "error",
        "message": "dictionary does not contain key \"nmae\"",
        "file": "main.typ",
        "line": 2,
        "column": 15
      }
    ]
  }
}
```

Response headers on `200`: `x-typst-version`, `x-render-duration-ms`, `x-typst-warnings`.

### `GET /health`

Returns `{ "status": "ok", "typstVersion": "0.15.1", "renders": { ... } }`. The worker checks Typst at startup and does not start without it.

### API documentation

| Where                                    | What                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| `/docs`                                  | Swagger UI. Use "Try it out" and download the PDF.          |
| `/docs/json`                             | OpenAPI 3.1 document                                        |
| [`docs/openapi.json`](docs/openapi.json) | The same document as a file. `pnpm check` keeps it current. |

## Configuration

Environment variables. The worker checks them at startup and lists every invalid one.

| Variable                            | Default                       | Description                                                                                                                   |
| ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                              | `3000`                        | HTTP port                                                                                                                     |
| `HOST`                              | `127.0.0.1`                   | Bind address. The Docker image uses `0.0.0.0`.                                                                                |
| `LOG_LEVEL`                         | `info`                        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                                  |
| `LOG_FORMAT`                        | `json`                        | `json` for log collectors, `pretty` for one readable line per event. `pnpm start` sets `pretty`.                              |
| `TYPST_BIN`                         | `typst`                       | Path to the Typst binary                                                                                                      |
| `DOCSPAWNER_FONT_PATHS`             | none                          | Extra font folders, separated by `:`                                                                                          |
| `DOCSPAWNER_PACKAGE_PATH`           | `typst-packages/` in the repo | Folder with the allowlisted Typst packages. `pnpm packages` installs them there. The Docker image sets `/opt/typst-packages`. |
| `DOCSPAWNER_MAX_CONCURRENT_RENDERS` | number of CPUs                | Renders that run at the same time. Match it to the CPUs of the container.                                                     |
| `DOCSPAWNER_MAX_QUEUED_RENDERS`     | `100`                         | Renders that wait for a free slot. More requests get `503`.                                                                   |

## Guarantees and limits

**Deterministic output.** The same template, data, and `options.timestamp` give a byte-identical PDF. The Typst version is pinned, system fonts are ignored, and the timestamp sets the document date.

**Untrusted templates.** A template is a program, so docspawner contains it:

| Risk                    | Control                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| Endless or slow compile | Timeout (default 10 s, max 60 s), then the process is killed     |
| Large input             | Template max 1 MB, data max 5 MB, HTTP body max 8 MB             |
| Read files on the host  | Typst only reads inside a fresh temp folder per render           |
| Network access          | Package downloads are blocked                                    |
| Resource use (Docker)   | Read-only file system, `tmpfs` for `/tmp`, memory and CPU limits |

**No authentication.** Run docspawner inside a trusted network or behind an API gateway.

**Capacity.** The worker runs `DOCSPAWNER_MAX_CONCURRENT_RENDERS` renders at once. Other requests wait in a first-in, first-out queue. The compile timeout starts when a render starts, so time in the queue does not count. When the queue is full, the worker returns `503` with `Retry-After` at once. `/health` reports the current load.

## Running in production

docspawner is a stateless worker: scale it by running more copies behind a load balancer.

| Topic       | What the image and `docker-compose.yml` do                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Image       | `node:24-slim`, Typst 0.15.1 (SHA-256 checked at build), the built worker. No build tools.      |
| User        | Runs as `node`, not root. All Linux capabilities dropped, `no-new-privileges`.                  |
| File system | Read-only. Temp files go to a 256 MB `tmpfs` at `/tmp`.                                         |
| Resources   | 1 CPU, 512 MB, at most 128 processes. Set `DOCSPAWNER_MAX_CONCURRENT_RENDERS` to the CPU count. |
| Health      | Docker `HEALTHCHECK` on `/health` every 15 s. Use the same endpoint for load balancer checks.   |
| Shutdown    | On `SIGTERM`, stops accepting requests and finishes running and queued renders (up to 25 s).    |
| Signals     | `init: true` forwards signals and reaps child processes.                                        |
| Logs        | JSON lines on stdout (Fastify/pino), with request IDs.                                          |

To size a deployment: one render slot per CPU, and enough copies that the queue stays short at peak. `/health` shows `active` and `queued` for each copy.

## Performance

`pnpm bench` renders the example invoice (42 items, 3 pages, with `lilaq` and `tiaoma`) through the render service, without HTTP, on an Apple Silicon laptop with Typst 0.15.1:

| Runs            | p50       | p95        | PDF size  |
| --------------- | --------- | ---------- | --------- |
| 3 × 100 renders | 97–104 ms | 100–116 ms | 100.6 KiB |

Each render includes the start of a new Typst process and the load of the packages. A plain invoice without packages renders in about 20 ms.

### As a worker

Measured against the Docker image with `docker-compose.yml` settings: 1 CPU, 512 MB, 1 render slot. The invoice rows come from `pnpm examples -l <requests> -c <clients> invoice`. The burst, shutdown, and memory rows come from earlier tests with a heavier template.

| Test                                               | Result                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| Example invoice, 100 requests, 1 at a time         | 7.3 PDF/s · p50 126 ms · p95 141 ms                             |
| Example invoice, 100 requests, 64 at a time        | 7.7 PDF/s · p50 6.5 s · p95 8.3 s · up to 63 queued · all `200` |
| Burst of 80 heavy renders (~200 ms each) at once   | 80 of 80 succeed in 14 s                                        |
| Burst of 200 heavy renders, queue of 100           | 101 succeed, 99 get `503` with `Retry-After`                    |
| `docker compose stop` with 1 running and 22 queued | All 30 requests finish with `200`, stop in 4 s                  |
| Peak memory under load                             | under 100 MiB                                                   |

Without the render queue, the same burst of 80 heavy renders failed 72 of 80 with `408`: every render shared one CPU and reached the timeout. See [ADR-0011](docs/adr/0011-bounded-render-queue.md).

## Architecture

docspawner uses **hexagonal architecture** (ports and adapters), with the standard layout from Tom Hombergs' _Get Your Hands Dirty on Clean Architecture_. The full explanation is in [ADR-0004](docs/adr/0004-ports-and-adapters.md).

**Interactive architecture diagram:** <https://aesbetancourt.dev/docspawner/>. Its source is [`docs/architecture/architecture.json`](docs/architecture/architecture.json), drawn with Archify.

One rule organizes the folders: **`in` means someone calls us. `out` means we call someone.**

```
src/
├── domain/                     The data the worker works with
│   └── render.ts                   request, result, errors, limits
├── application/                The core logic
│   ├── port/
│   │   ├── in/                     What we offer     → RenderDocument
│   │   └── out/                    What we need      → TypstCompiler, Clock
│   └── service/                    How we do it      → render service, input checks, render slots
├── adapter/                    The outside world
│   ├── in/http/                    Requests come in  → Fastify routes, schemas, Swagger
│   └── out/
│       ├── typst/                  We call Typst     → runs the binary, parses its errors
│       └── clock/                  We read the time  → system clock
├── config.ts                   Settings from environment variables
└── main.ts                     Builds everything and starts the worker

test/                           Same folders as src/, plus the architecture test
```

```mermaid
flowchart LR
  HTTP[adapter/in/http] -->|calls| IN([port/in: RenderDocument])
  SVC[application/service] -.implements.-> IN
  SVC -->|calls| OUT([port/out: TypstCompiler, Clock])
  TYPST[adapter/out/typst] -.implements.-> OUT
  CLOCK[adapter/out/clock] -.implements.-> OUT
```

**The dependency rule:** every import points inward. `domain` and `application` never import an adapter, and only adapters do I/O. [`test/architecture.test.ts`](test/architecture.test.ts) checks every import in `src/`.

Expected failures are values, not exceptions. The HTTP adapter maps them to status codes.

Around the code:

| Folder              | Contents                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/`         | Example templates, data, and rendered PDFs, and `render.sh` to render them with a running worker and show metrics                                                                  |
| `docs/adr/`         | Architecture decision records                                                                                                                                                      |
| `docs/openapi.json` | The API contract, generated from the route schemas                                                                                                                                 |
| `scripts/`          | `bench.ts` (render speed), `export-openapi.ts` (writes the API contract), `example-previews.sh` (README page images), `install-typst-packages.sh` (installs the package allowlist) |

## Decisions

Architecture decision records are in [`docs/adr/`](docs/adr/):

| ADR                                                        | Decision                                                |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| [0001](docs/adr/0001-typst-instead-of-headless-browser.md) | Typst instead of a headless browser (Puppeteer)         |
| [0002](docs/adr/0002-stateless-renderer.md)                | Stateless renderer: the caller sends the full template  |
| [0003](docs/adr/0003-data-contract-data-json.md)           | Data reaches the template as the file `data.json`       |
| [0004](docs/adr/0004-ports-and-adapters.md)                | Hexagonal architecture (ports and adapters)             |
| [0005](docs/adr/0005-typst-cli-process-per-render.md)      | Run the Typst CLI as a new process for each render      |
| [0006](docs/adr/0006-deterministic-output.md)              | Same input, same PDF bytes                              |
| [0007](docs/adr/0007-contain-untrusted-templates.md)       | Treat every template as untrusted code                  |
| [0008](docs/adr/0008-mcp-returns-paths-and-text-errors.md) | MCP tools return paths and text errors (deprecated)     |
| [0009](docs/adr/0009-no-cli-adapter.md)                    | No CLI adapter                                          |
| [0010](docs/adr/0010-http-api-only.md)                     | HTTP API only: the MCP adapter is removed               |
| [0011](docs/adr/0011-bounded-render-queue.md)              | A fixed number of render slots and a bounded queue      |
| [0012](docs/adr/0012-allowlisted-typst-packages.md)        | An allowlist of Typst packages, installed at build time |
| [0013](docs/adr/0013-core-checks-only-its-own-rules.md)    | The core checks only its own rules, without Zod         |

## Development

Requirements: Node 24 (see `.nvmrc`), pnpm, and Typst 0.15.1 on `PATH`.

```sh
pnpm install
pnpm start         # install the packages, build, and start the worker on :3000 with readable logs
pnpm check         # every check in one command
```

| Command                             | Purpose                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm check`                        | Every check: format, lint, unused code, types, tests with coverage, OpenAPI file |
| `pnpm test` / `pnpm test:coverage`  | Unit, adapter, architecture, example, and end-to-end tests (real Typst)          |
| `pnpm format` / `pnpm format:check` | Format with oxfmt / check the format                                             |
| `pnpm lint`                         | Type-aware oxlint. Warnings fail, and lint-suppression comments fail.            |
| `pnpm knip`                         | Find unused files, exports, and dependencies                                     |
| `pnpm packages`                     | Install the allowlisted Typst packages (also runs before `pnpm test`)            |
| `pnpm typecheck`                    | Type check                                                                       |
| `pnpm openapi`                      | Regenerate `docs/openapi.json`                                                   |
| `pnpm examples`                     | Render the examples with a running worker and show the metrics                   |
| `pnpm bench`                        | Measure render time without HTTP                                                 |
| `pnpm previews`                     | Render the example page images in `docs/images/examples/`                        |

Code standards for contributors and AI agents are in [`CLAUDE.md`](CLAUDE.md).

`pnpm check` runs every check above in one command.

## Scope

docspawner does one thing. Out of scope by design: template storage and versioning, authentication, an editor, async jobs, multi-file templates, and an MCP server.

## License

[MIT](LICENSE)
