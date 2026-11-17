# Typst instead of a headless browser

Status: accepted

We first generated PDFs with Puppeteer: render HTML in headless Chromium, then print to PDF. It was very slow and expensive in CPU, memory, and time per document. docspawner uses Typst, a typesetting engine that compiles markup straight to PDF with no browser.

The example 2-page invoice renders in about 19 ms (p50) on a laptop, including the process start (`pnpm bench`).

## Considered options

- **Puppeteer / headless Chromium**: reuses HTML and CSS skills and the JS ecosystem (charts, web fonts). But each render runs a full browser, cold starts are slow, the image is large, and page breaks in long tables are hard to control.
- **PDF libraries (pdfkit, react-pdf)**: no browser, but layout is manual or limited, and the templates are code, not documents.
- **Typst**: fast, small single binary, real typesetting (page breaks, repeated table headers, footers), and deterministic output. **Chosen.**

## Consequences

- Templates are written in Typst, not HTML. Teams must learn a new markup language, and existing HTML templates must be rewritten.
- JS chart libraries are not available. Charts must be drawn in Typst.
- Typst is pre-1.0, so the syntax can change between versions. We pin the version (see ADR-0006).
