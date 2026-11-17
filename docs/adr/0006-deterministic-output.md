# Same input, same PDF bytes

Status: accepted

The same template, data, and timestamp must give a byte-identical PDF on any machine. This makes golden-file tests possible, makes caching safe, and lets a caller store the input instead of the PDF and render it again later.

Four things change Typst output, so we fix all four:

1. **Typst version**: pinned in the Docker image (0.15.1).
2. **Fonts**: system fonts are always ignored (`--ignore-system-fonts`). Only fonts embedded in Typst and configured font folders are used.
3. **Date**: `datetime.today()` and the PDF creation date use the current time. The caller can send `options.timestamp`.
4. **Packages**: `typst-packages/allowlist.typ` pins each package to an exact version, and downloads are blocked at render time (ADR-0012).

## Considered options

For a request with no timestamp:

- **Fixed default (for example 0)**: deterministic by default, but `datetime.today()` shows 1970.
- **Current time from a `Clock` port**: natural dates, and byte identity only when the caller sends a timestamp. **Chosen.** Tests inject a fixed clock.
