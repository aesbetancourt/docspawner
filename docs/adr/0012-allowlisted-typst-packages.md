# An allowlist of Typst packages, installed at build time

Status: accepted

Real documents need more than built-in shapes: chemical structures, scientific charts, process diagrams, and GS1 codes for serialization. Typst packages provide these. But a template is untrusted code (ADR-0007), so the worker must not download packages while it renders.

We keep both: templates may import packages from a fixed allowlist, and the packages are installed once, at build time.

- `typst-packages/allowlist.typ` lists each package with an exact version. Typst package versions are immutable, so the same allowlist always gives the same files.
- `pnpm packages` (and the Docker build) runs Typst once with network access to download the allowlist and its dependencies into a folder.
- The worker gets that folder through `DOCSPAWNER_PACKAGE_PATH` (`--package-path`). Downloads stay blocked at render time, so an import outside the allowlist fails with a clear error.

The allowlist today:

| Package     | Purpose                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `alchemist` | Skeletal formulas of molecules                                              |
| `lilaq`     | Scientific plots: error bars, heat maps, fitted lines                       |
| `fletcher`  | Diagrams with nodes and arrows, such as process flows                       |
| `tiaoma`    | Barcodes, QR codes and GS1 DataMatrix, made by Zint compiled to WebAssembly |
| `zero`      | Scientific number formatting                                                |

## Considered options

- **No packages:** the safest, but complex documents need hand-drawn charts and cannot have barcodes.
- **Download at render time:** any template could pull any package from the network, and the output would depend on what is cached on the host.
- **Allowlist installed at build time:** **chosen**. Rendering stays offline and deterministic.

## Consequences

- Adding a package is a code change: one line in `allowlist.typ`, then `pnpm packages`.
- The Docker image grows by about 4 MB.
- `tiaoma` runs a WebAssembly plugin inside Typst. Typst runs plugins in a sandbox with no file or network access.
