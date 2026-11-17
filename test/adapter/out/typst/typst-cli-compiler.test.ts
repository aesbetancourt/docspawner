import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRealRenderer } from "../../../support/real-renderer.js";

// Render service with the real Typst CLI adapter. These tests run the real typst binary.

const renderer = createRealRenderer();

const TEMPLATE = `#let data = json("data.json")
= Invoice #data.number
Customer: #data.customer
`;
const DATA = { number: "INV-001", customer: "Ana" };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("render with the real Typst CLI", () => {
  it("1. renders a valid template and data to a PDF", async () => {
    const result = await renderer.render({ template: TEMPLATE, data: DATA });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextDecoder().decode(result.pdf.subarray(0, 5))).toBe("%PDF-");
    expect(result.meta.typstVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("2. returns errors with the line and column for a broken template", async () => {
    const template = `= Title\n\nHello #unknownvar\n`;
    const result = await renderer.render({ template, data: {} });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "compile_failed",
        diagnostics: [
          { severity: "error", message: "unknown variable: unknownvar", file: "main.typ", line: 3, column: 8 },
        ],
      },
    });
  });

  it("3. returns the same bytes for the same input and timestamp", async () => {
    const request = { template: TEMPLATE, data: DATA, options: { timestamp: 1_700_000_000 } };
    const first = await renderer.render(request);
    const second = await renderer.render(request);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(sha256(first.pdf)).toBe(sha256(second.pdf));
  });

  it("4. stops a slow template at the timeout", async () => {
    const template = `#let s = 0\n#for i in range(20000) { for j in range(20000) { s += 1 } }\n#s\n`;
    const started = Date.now();
    const result = await renderer.render({ template, data: {}, options: { timeoutMs: 300 } });

    expect(result).toEqual({ ok: false, error: { kind: "timeout", timeoutMs: 300 } });
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("hardening", () => {
  it("does not download packages from the network by default", async () => {
    const started = Date.now();
    const result = await renderer.render({ template: '#import "@preview/tablex:0.0.9"\nhi', data: {} });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "compile_failed",
        diagnostics: [{ hints: [expect.stringContaining("package downloads are disabled")] }],
      },
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("cannot read files outside the render folder", async () => {
    const result = await renderer.render({ template: '#read("/etc/passwd")', data: {} });
    expect(result).toMatchObject({ ok: false, error: { kind: "compile_failed" } });
    // The error must not show the internal temp folder.
    expect(JSON.stringify(result)).not.toContain("docspawner-");
  });
});
