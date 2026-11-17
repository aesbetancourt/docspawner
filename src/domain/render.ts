// The data the worker works with: a render request, its result, and its limits.
// This file has no imports and no logic. Every other layer may import it.

/** Severity of a problem that Typst reports. */
export const DIAGNOSTIC_SEVERITY = {
  error: "error",
  warning: "warning",
} as const;

/** `"error"` or `"warning"`, derived from `DIAGNOSTIC_SEVERITY`. */
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITY)[keyof typeof DIAGNOSTIC_SEVERITY];

/** One problem that Typst reports for a template. */
export interface Diagnostic {
  /** An error stops the render. A warning does not. */
  severity: DiagnosticSeverity;
  /** The message from Typst, for example "unknown variable: nmae". */
  message: string;
  /** File that has the problem. "main.typ" is the caller's template. */
  file?: string;
  /** 1-based line number. */
  line?: number;
  /** 1-based column number. */
  column?: number;
  /** Suggestions from Typst to fix the problem. */
  hints?: string[];
}

/** The file name under which a template receives its data. This is the whole template contract. */
export const DATA_FILE_NAME = "data.json";

/** Optional settings for one render. */
interface RenderOptions {
  /** Maximum compile time in milliseconds. */
  timeoutMs?: number;
  /** Document creation time as a UNIX timestamp in seconds. Send it for byte-identical output. */
  timestamp?: number;
}

/** What a caller sends: a template, its data, and optional settings. */
export interface RenderRequest {
  /** Full Typst source. It reads the data with `json("data.json")`. */
  template: string;
  /** Any JSON value. The template gets it as the file `data.json`. */
  data: unknown;
  /** Optional settings. The limits in `RenderLimits` apply. */
  options?: RenderOptions;
}

/** The request fields that have a size limit. */
export const LIMITED_FIELD = {
  template: "template",
  data: "data",
} as const;

/** `"template"` or `"data"`, derived from `LIMITED_FIELD`. */
export type LimitedField = (typeof LIMITED_FIELD)[keyof typeof LIMITED_FIELD];

/** Every reason a render can fail. The HTTP adapter maps each one to a status code. */
export const RENDER_ERROR_KIND = {
  invalidInput: "invalid_input",
  inputTooLarge: "input_too_large",
  compileFailed: "compile_failed",
  timeout: "timeout",
  busy: "busy",
} as const;

/** One value of `RENDER_ERROR_KIND`, for example `"compile_failed"`. */
export type RenderErrorKind = (typeof RENDER_ERROR_KIND)[keyof typeof RENDER_ERROR_KIND];

/**
 * An expected failure, as a value. Each kind carries the details a caller needs to act on it.
 * This is a discriminated union: check `kind` and TypeScript knows the other fields.
 */
export type RenderError =
  | { kind: typeof RENDER_ERROR_KIND.invalidInput; message: string }
  | { kind: typeof RENDER_ERROR_KIND.inputTooLarge; field: LimitedField; limitBytes: number }
  | { kind: typeof RENDER_ERROR_KIND.compileFailed; diagnostics: Diagnostic[] }
  | { kind: typeof RENDER_ERROR_KIND.timeout; timeoutMs: number }
  | { kind: typeof RENDER_ERROR_KIND.busy; retryAfterSeconds: number };

/** Facts about a successful render. The HTTP adapter sends them as response headers. */
interface RenderMeta {
  /** Typst version that made the PDF, for example "0.15.1". */
  typstVersion: string;
  /** Time from the start of the render to the PDF, including any wait for a free slot. */
  durationMs: number;
  /** Problems that did not stop the render. */
  warnings: Diagnostic[];
}

/** The result of a render: a PDF with its metadata, or an error. It is never thrown. */
export type RenderResult = { ok: true; pdf: Uint8Array; meta: RenderMeta } | { ok: false; error: RenderError };

/** How busy the worker is: renders running now and renders waiting for a slot. */
export interface RenderLoad {
  /** Renders that run now. */
  active: number;
  /** Renders that wait for a free slot. */
  queued: number;
  /** Largest number of renders that run at the same time. */
  maxConcurrent: number;
  /** Largest number of renders that wait. */
  maxQueued: number;
}

/** Size and time limits for one render. */
export interface RenderLimits {
  /** Largest template in bytes, as UTF-8. */
  maxTemplateBytes: number;
  /** Largest data in bytes, as UTF-8 JSON. */
  maxDataBytes: number;
  /** Compile timeout when the request does not set `options.timeoutMs`. */
  defaultTimeoutMs: number;
  /** Largest `options.timeoutMs` that a caller can ask for. */
  maxTimeoutMs: number;
}

/** The limits the worker uses. The API schema and the OpenAPI document read them from here. */
export const DEFAULT_LIMITS: RenderLimits = {
  maxTemplateBytes: 1_000_000,
  maxDataBytes: 5_000_000,
  defaultTimeoutMs: 10_000,
  maxTimeoutMs: 60_000,
};
