// The data the worker works with: a render request, its result, and its limits.

/** Severity of a problem that Typst reports. */
export const DIAGNOSTIC_SEVERITY = {
  error: "error",
  warning: "warning",
} as const;

export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITY)[keyof typeof DIAGNOSTIC_SEVERITY];

/** One problem that Typst reports for a template. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** File that has the problem. "main.typ" is the caller's template. */
  file?: string;
  line?: number;
  column?: number;
  hints?: string[];
}

/** The file name under which a template receives its data. This is the whole template contract. */
export const DATA_FILE_NAME = "data.json";

interface RenderOptions {
  /** Maximum compile time in milliseconds. */
  timeoutMs?: number;
  /** Document creation time as a UNIX timestamp in seconds. Send it for byte-identical output. */
  timestamp?: number;
}

export interface RenderRequest {
  /** Full Typst source. It reads the data with `json("data.json")`. */
  template: string;
  /** Any JSON value. The template gets it as the file `data.json`. */
  data: unknown;
  options?: RenderOptions;
}

/** The request fields that have a size limit. */
export const LIMITED_FIELD = {
  template: "template",
  data: "data",
} as const;

export type LimitedField = (typeof LIMITED_FIELD)[keyof typeof LIMITED_FIELD];

/** Every reason a render can fail. The HTTP adapter maps each one to a status code. */
export const RENDER_ERROR_KIND = {
  invalidInput: "invalid_input",
  inputTooLarge: "input_too_large",
  compileFailed: "compile_failed",
  timeout: "timeout",
  busy: "busy",
} as const;

export type RenderErrorKind = (typeof RENDER_ERROR_KIND)[keyof typeof RENDER_ERROR_KIND];

export type RenderError =
  | { kind: typeof RENDER_ERROR_KIND.invalidInput; message: string }
  | { kind: typeof RENDER_ERROR_KIND.inputTooLarge; field: LimitedField; limitBytes: number }
  | { kind: typeof RENDER_ERROR_KIND.compileFailed; diagnostics: Diagnostic[] }
  | { kind: typeof RENDER_ERROR_KIND.timeout; timeoutMs: number }
  | { kind: typeof RENDER_ERROR_KIND.busy; retryAfterSeconds: number };

interface RenderMeta {
  typstVersion: string;
  /** Time from the start of the render to the PDF, including any wait for a free slot. */
  durationMs: number;
  warnings: Diagnostic[];
}

export type RenderResult = { ok: true; pdf: Uint8Array; meta: RenderMeta } | { ok: false; error: RenderError };

/** How busy the worker is: renders running now and renders waiting for a slot. */
export interface RenderLoad {
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueued: number;
}

export interface RenderLimits {
  maxTemplateBytes: number;
  maxDataBytes: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
}

export const DEFAULT_LIMITS: RenderLimits = {
  maxTemplateBytes: 1_000_000,
  maxDataBytes: 5_000_000,
  defaultTimeoutMs: 10_000,
  maxTimeoutMs: 60_000,
};
