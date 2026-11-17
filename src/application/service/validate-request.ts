import * as z from "zod/v4";
import {
  LIMITED_FIELD,
  RENDER_ERROR_KIND,
  type LimitedField,
  type RenderError,
  type RenderLimits,
  type RenderRequest,
} from "../../domain/render.js";

interface ValidatedInput {
  source: string;
  dataJson: Uint8Array;
  timeoutMs: number;
  timestamp: number | undefined;
}

export type ValidationResult = { ok: true; value: ValidatedInput } | { ok: false; error: RenderError };

/** Marks a Zod issue as a size-limit failure, so it maps to `input_too_large` and not `invalid_input`. */
interface TooLargeParams {
  kind: typeof RENDER_ERROR_KIND.inputTooLarge;
  field: LimitedField;
  limitBytes: number;
}

const encoder = new TextEncoder();
const schemas = new WeakMap<RenderLimits, ReturnType<typeof createRequestSchema>>();

/**
 * Check a render request against the limits. Pure: no I/O.
 * @param request - The request as the caller sent it.
 * @param limits - The size and time limits to apply.
 * @returns The validated input, or the first error to report.
 */
export function validateRequest(request: RenderRequest, limits: RenderLimits): ValidationResult {
  const parsed = schemaFor(limits).safeParse(request);
  if (!parsed.success) {
    return { ok: false, error: toRenderError(parsed.error.issues) };
  }

  const { template, data, options } = parsed.data;
  return {
    ok: true,
    value: {
      source: template.text,
      dataJson: data,
      timeoutMs: options?.timeoutMs ?? limits.defaultTimeoutMs,
      timestamp: options?.timestamp,
    },
  };
}

/** Build the schema once per limits object, because the limits are part of the schema. */
function schemaFor(limits: RenderLimits): ReturnType<typeof createRequestSchema> {
  const cached = schemas.get(limits);
  if (cached) {
    return cached;
  }
  const schema = createRequestSchema(limits);
  schemas.set(limits, schema);
  return schema;
}

function createRequestSchema(limits: RenderLimits) {
  return z.object({
    template: z
      .string({ error: "template must be a string" })
      .refine((text) => text.trim() !== "", "template must not be empty")
      .transform((text, ctx) => {
        const bytes = encoder.encode(text);
        if (bytes.byteLength > limits.maxTemplateBytes) {
          return tooLarge(ctx, LIMITED_FIELD.template, limits.maxTemplateBytes);
        }
        return { text, bytes };
      }),

    data: z.unknown().transform((value, ctx) => {
      const text = toJson(value);
      if (text === undefined) {
        ctx.issues.push({ code: "custom", message: "data must be a JSON value", input: value });
        return z.NEVER;
      }
      const bytes = encoder.encode(text);
      if (bytes.byteLength > limits.maxDataBytes) {
        return tooLarge(ctx, LIMITED_FIELD.data, limits.maxDataBytes);
      }
      return bytes;
    }),

    options: z
      .object({
        timeoutMs: z.int().min(1).max(limits.maxTimeoutMs).optional(),
        timestamp: z.int().min(0).optional(),
      })
      .optional(),
  });
}

function tooLarge(ctx: z.core.$RefinementCtx, field: LimitedField, limitBytes: number): never {
  const params: TooLargeParams = { kind: RENDER_ERROR_KIND.inputTooLarge, field, limitBytes };
  ctx.issues.push({
    code: "custom",
    message: `${field} is larger than ${limitBytes} bytes`,
    input: undefined,
    params: { ...params },
  });
  return z.NEVER;
}

function isTooLargeParams(value: unknown): value is TooLargeParams {
  return (
    typeof value === "object" && value !== null && "kind" in value && value.kind === RENDER_ERROR_KIND.inputTooLarge
  );
}

/** Map Zod issues to one core error. A size-limit failure wins over other problems. */
function toRenderError(issues: z.core.$ZodIssue[]): RenderError {
  for (const issue of issues) {
    if (issue.code === "custom" && isTooLargeParams(issue.params)) {
      const { field, limitBytes } = issue.params;
      return { kind: RENDER_ERROR_KIND.inputTooLarge, field, limitBytes };
    }
  }

  const message = issues.map(describeIssue).join("; ");
  return { kind: RENDER_ERROR_KIND.invalidInput, message };
}

/** "options.timeoutMs: Too small", or the message alone when the issue is about the whole request. */
function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.path.length === 0) {
    return issue.message;
  }
  return `${issue.path.join(".")}: ${issue.message}`;
}

function toJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    // A circular object or a BigInt cannot become JSON.
    return undefined;
  }
}
