// Parser for the "human" diagnostic format of the Typst CLI. Example input:
//
//   error: unknown variable: nmae
//     ┌─ main.typ:3:7
//     │
//   3 │ Hello #nmae
//     │        ^^^^
//     = hint: ...
import { DIAGNOSTIC_SEVERITY, type Diagnostic, type DiagnosticSeverity } from "../../../domain/render.js";

/** "error: message" or "warning: message". It starts a new diagnostic. */
const HEADER = /^(error|warning): (.*)$/;
/** "┌─ file:line:column". The first one gives the location of the diagnostic. */
const LOCATION = /^\s*┌─ (.+):(\d+):(\d+)\s*$/;
/** "= hint: text". */
const HINT = /^\s*= hint: (.*)$/;

/**
 * Parse the "human" diagnostic format of the Typst CLI.
 * The "short" format drops hints, and hints help callers fix a template.
 * @param stderr - The text Typst wrote to stderr.
 * @returns One diagnostic per error or warning, with 1-based line and column when Typst gives a location.
 */
export function parseTypstDiagnostics(stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let current: Diagnostic | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      current = { severity: toSeverity(header[1]), message: (header[2] ?? "").trim() };
      diagnostics.push(current);
    } else if (current) {
      addDetail(current, line);
    }
  }

  return diagnostics;
}

/**
 * Map the first word of a header line to a severity.
 * @param word - "error" or "warning".
 * @returns The severity. Anything that is not "warning" is an error.
 */
function toSeverity(word: string | undefined): DiagnosticSeverity {
  if (word === DIAGNOSTIC_SEVERITY.warning) {
    return DIAGNOSTIC_SEVERITY.warning;
  }
  return DIAGNOSTIC_SEVERITY.error;
}

/**
 * Add a location or a hint line to the diagnostic it belongs to. Other lines (the source excerpt) are ignored.
 * @param diagnostic - The diagnostic to change in place.
 * @param line - One line of stderr after the header.
 */
function addDetail(diagnostic: Diagnostic, line: string): void {
  const [, file, lineNumber, column] = LOCATION.exec(line) ?? [];
  if (file && diagnostic.line === undefined) {
    diagnostic.file = file;
    diagnostic.line = Number(lineNumber);
    // Typst prints 0-based columns. Editors and people expect 1-based columns.
    diagnostic.column = Number(column) + 1;
    return;
  }

  const hint = HINT.exec(line)?.[1];
  if (hint) {
    diagnostic.hints ??= [];
    diagnostic.hints.push(hint.trim());
  }
}
