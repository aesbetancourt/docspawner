// The core's own rules for a render request. Pure: no I/O.
// Each driving adapter checks the shape of its input (the HTTP adapter uses JSON Schema).
// The core checks only what is true for every adapter: no empty template, the size limits, and the option ranges.
import {
  LIMITED_FIELD,
  RENDER_ERROR_KIND,
  type LimitedField,
  type RenderError,
  type RenderLimits,
  type RenderRequest,
} from "../../domain/render.js";

/** A request after the checks: ready to give to the compiler. */
interface ValidatedInput {
  /** The template text. */
  source: string;
  /** The data, as UTF-8 JSON bytes. The compiler writes them to `data.json`. */
  dataJson: Uint8Array;
  /** The timeout from the request, or the default timeout. */
  timeoutMs: number;
  /** The timestamp from the request. `undefined` means "use the current time". */
  timestamp: number | undefined;
}

/** The validated input, or the first error to report. */
export type ValidationResult = { ok: true; value: ValidatedInput } | { ok: false; error: RenderError };

const encoder = new TextEncoder();

/**
 * Check a render request against the core's rules. A size-limit failure wins over other problems.
 * @param request - The request from a driving adapter.
 * @param limits - The size and time limits to apply.
 * @returns The validated input, or an `input_too_large` or `invalid_input` error.
 */
export function validateRequest(request: RenderRequest, limits: RenderLimits): ValidationResult {
  const dataJson = encodeJson(request.data);

  if (encoder.encode(request.template).byteLength > limits.maxTemplateBytes) {
    return tooLarge(LIMITED_FIELD.template, limits.maxTemplateBytes);
  }
  if (dataJson !== undefined && dataJson.byteLength > limits.maxDataBytes) {
    return tooLarge(LIMITED_FIELD.data, limits.maxDataBytes);
  }

  const problems = findProblems(request, dataJson, limits);
  if (dataJson === undefined || problems.length > 0) {
    return { ok: false, error: { kind: RENDER_ERROR_KIND.invalidInput, message: problems.join("; ") } };
  }

  return {
    ok: true,
    value: {
      source: request.template,
      dataJson,
      timeoutMs: request.options?.timeoutMs ?? limits.defaultTimeoutMs,
      timestamp: request.options?.timestamp,
    },
  };
}

/**
 * List every rule the request breaks, other than the size limits.
 * @param request - The request.
 * @param dataJson - The data as JSON bytes, or `undefined` when it is not a JSON value.
 * @param limits - The limits, for the timeout range.
 * @returns One message per problem, or an empty list.
 */
function findProblems(request: RenderRequest, dataJson: Uint8Array | undefined, limits: RenderLimits): string[] {
  const problems: string[] = [];
  if (request.template.trim() === "") {
    problems.push("template must not be empty");
  }
  if (dataJson === undefined) {
    problems.push("data must be a JSON value");
  }
  const timeoutMs = request.options?.timeoutMs;
  if (timeoutMs !== undefined && !isIntegerIn(timeoutMs, 1, limits.maxTimeoutMs)) {
    problems.push(`options.timeoutMs must be an integer from 1 to ${limits.maxTimeoutMs}`);
  }
  const timestamp = request.options?.timestamp;
  if (timestamp !== undefined && !isIntegerIn(timestamp, 0, Number.MAX_SAFE_INTEGER)) {
    problems.push("options.timestamp must be an integer of 0 or more");
  }
  return problems;
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function tooLarge(field: LimitedField, limitBytes: number): ValidationResult {
  return { ok: false, error: { kind: RENDER_ERROR_KIND.inputTooLarge, field, limitBytes } };
}

/**
 * Turn the data into UTF-8 JSON bytes.
 * @param value - The data as the caller sent it.
 * @returns The bytes, or `undefined` when the value cannot become JSON.
 */
function encodeJson(value: unknown): Uint8Array | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return encoder.encode(JSON.stringify(value));
  } catch {
    // A circular object or a BigInt cannot become JSON.
    return undefined;
  }
}
