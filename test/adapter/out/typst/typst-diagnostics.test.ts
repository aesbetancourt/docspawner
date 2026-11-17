import { describe, expect, it } from "vitest";
import { parseTypstDiagnostics } from "../../../../src/adapter/out/typst/typst-diagnostics.js";

// Output copied from typst 0.15.1 with --diagnostic-format human.
const STDERR = `error: unknown variable: ab
  ┌─ main.typ:1:2
  │
1 │ $ ab $
  │   ^^
  │
  = hint: if you meant to display multiple letters as is, try adding spaces between each letter: \`a b\`
  = hint: or if you meant to display this as text, try placing it in quotes: \`"ab"\`

warning: unknown font family: nope
  ┌─ main.typ:1:16
  │
1 │ #set text(font: "Nope")
  │                 ^^^^^^
`;

describe("parseTypstDiagnostics", () => {
  it("parses errors, warnings, locations (1-based columns), and hints", () => {
    expect(parseTypstDiagnostics(STDERR)).toEqual([
      {
        severity: "error",
        message: "unknown variable: ab",
        file: "main.typ",
        line: 1,
        column: 3,
        hints: [
          "if you meant to display multiple letters as is, try adding spaces between each letter: `a b`",
          'or if you meant to display this as text, try placing it in quotes: `"ab"`',
        ],
      },
      { severity: "warning", message: "unknown font family: nope", file: "main.typ", line: 1, column: 17 },
    ]);
  });

  it("parses a diagnostic with no location", () => {
    expect(parseTypstDiagnostics("error: input file not found\n")).toEqual([
      { severity: "error", message: "input file not found" },
    ]);
  });

  it("ignores lines that are not diagnostics", () => {
    expect(parseTypstDiagnostics("downloading @preview/cetz:0.3.0\n\n")).toEqual([]);
  });
});
