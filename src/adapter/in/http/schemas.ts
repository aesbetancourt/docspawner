// JSON Schemas for the HTTP API. Fastify uses them to validate requests and serialize
// responses, and @fastify/swagger uses them to generate the OpenAPI document.
// Response schemas also act as a filter: a field that is not listed here is not sent.

import { DEFAULT_LIMITS, DIAGNOSTIC_SEVERITY, LIMITED_FIELD, RENDER_ERROR_KIND } from "../../../domain/render.js";

/** The status `/health` reports while the worker runs. */
export const HEALTH_STATUS_OK = "ok";

/** Error kinds that only the HTTP adapter produces. The core's kinds are in `RENDER_ERROR_KIND`. */
export const HTTP_ERROR_KIND = {
  notFound: "not_found",
  internal: "internal",
} as const;

/** Largest HTTP request body. It must be larger than the template and data limits together. */
export const BODY_LIMIT_BYTES = 8_000_000;

/**
 * Format a byte count for the API description.
 * @param bytes - A size in bytes.
 * @returns For example "5 MB".
 */
function mb(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}

const { maxTemplateBytes, maxDataBytes, defaultTimeoutMs, maxTimeoutMs } = DEFAULT_LIMITS;

/** A small template for the request example in Swagger UI. */
const EXAMPLE_TEMPLATE = '#let data = json("data.json")\n= Invoice #data.number\nCustomer: #data.customer';

/** A shared schema: the 422 response refers to it with `$ref: "Diagnostic#"`. */
export const diagnosticSchema = {
  $id: "Diagnostic",
  type: "object",
  description: "One problem that Typst reports for the template.",
  required: ["severity", "message"],
  properties: {
    severity: { type: "string", enum: Object.values(DIAGNOSTIC_SEVERITY) },
    message: { type: "string", examples: ["unknown variable: nmae"] },
    file: {
      type: "string",
      description: 'File with the problem. "main.typ" is your template.',
      examples: ["main.typ"],
    },
    line: { type: "integer", minimum: 1, description: "1-based line number.", examples: [3] },
    column: { type: "integer", minimum: 1, description: "1-based column number.", examples: [8] },
    hints: {
      type: "array",
      items: { type: "string" },
      description: "Suggestions from Typst to fix the problem.",
    },
  },
} as const;

/** The body of `POST /render`. Fastify rejects a body that does not match, before the handler runs. */
export const renderRequestSchema = {
  $id: "RenderRequest",
  type: "object",
  required: ["template", "data"],
  additionalProperties: false,
  properties: {
    template: {
      type: "string",
      description: `Full Typst source (max ${mb(maxTemplateBytes)}). The template must read its data with \`#let data = json("data.json")\`.`,
    },
    data: {
      description: `Any JSON value (max ${mb(maxDataBytes)}). The template receives it as the file \`data.json\`.`,
    },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: maxTimeoutMs,
          description: `Maximum compile time in milliseconds. The compile is stopped after this time. Default: ${defaultTimeoutMs}.`,
        },
        timestamp: {
          type: "integer",
          minimum: 0,
          description:
            "Document creation time as a UNIX timestamp in seconds. Send it to get byte-identical output for the same input. Default: the current time.",
          examples: [1763251200],
        },
      },
    },
  },
  examples: [
    {
      template: EXAMPLE_TEMPLATE,
      data: { number: "INV-001", customer: "Globex Corporation" },
      options: { timestamp: 1763251200 },
    },
  ],
} as const;

/** The parts of one error response schema. */
interface ErrorSchemaParams {
  /** What the status code means, for the OpenAPI document. */
  description: string;
  /** The error kinds this status code can have. */
  kinds: readonly string[];
  /** The fields of `error` besides `kind`. */
  properties: Record<string, unknown>;
  /** The fields of `error` that are always present, besides `kind`. */
  required?: string[];
}

/**
 * Build the schema of an error response: `{ error: { kind, ...properties } }`.
 * @param params - The description, the kinds, and the fields of `error`.
 * @returns A JSON Schema for one status code.
 */
function errorSchema(params: Readonly<ErrorSchemaParams>) {
  return {
    description: params.description,
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["kind", ...(params.required ?? [])],
        properties: { kind: { type: "string", enum: params.kinds }, ...params.properties },
      },
    },
  } as const;
}

/** The headers of a 200 response, for the OpenAPI document. */
const PDF_HEADERS = {
  "content-disposition": {
    type: "string",
    description: 'Always `attachment; filename="document.pdf"`. Browsers and Swagger UI offer the PDF as a download.',
  },
  "x-typst-version": { type: "string", description: "Typst version that rendered the PDF." },
  "x-render-duration-ms": {
    type: "integer",
    description: "Render time in milliseconds, including any wait for a free slot.",
  },
  "x-typst-warnings": { type: "integer", description: "Number of Typst warnings. The PDF was still produced." },
} as const;

/** The OpenAPI and validation schema of `POST /render`, with every response. */
export const renderRouteSchema = {
  tags: ["render"],
  operationId: "renderDocument",
  summary: "Render a Typst template and JSON data to a PDF",
  description: [
    "Compiles the template with the data and returns the PDF.",
    "",
    '**Template contract:** the data is available as the file `data.json`. Read it with `#let data = json("data.json")`.',
    "",
    "**Determinism:** the same template, data, and `options.timestamp` give a byte-identical PDF.",
    "",
    `**Limits:** template ${mb(maxTemplateBytes)}, data ${mb(maxDataBytes)}, request body ${mb(BODY_LIMIT_BYTES)}, compile time ${defaultTimeoutMs / 1000} s by default (max ${maxTimeoutMs / 1000} s).`,
    "",
    "**Capacity:** the worker runs a fixed number of renders at once and queues the rest. The compile timeout starts when the render starts. When the queue is full, the worker returns `503` with `Retry-After`.",
    "",
    "**Fonts and packages:** system fonts are ignored. Templates can use the fonts embedded in Typst, the configured font folders, and the allowlisted Typst packages. Packages are never downloaded while rendering.",
  ].join("\n"),
  body: { $ref: "RenderRequest#" },
  response: {
    200: {
      description: "The rendered PDF.",
      headers: PDF_HEADERS,
      content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
    },
    400: errorSchema({
      description: "The request is not valid: a missing field, a wrong type, or an empty template.",
      kinds: [RENDER_ERROR_KIND.invalidInput],
      properties: { message: { type: "string" } },
    }),
    408: errorSchema({
      description: "The compile took more than `timeoutMs`. Typst was stopped.",
      kinds: [RENDER_ERROR_KIND.timeout],
      properties: { timeoutMs: { type: "integer" } },
      required: ["timeoutMs"],
    }),
    413: errorSchema({
      description: "The template, the data, or the request body is above its size limit.",
      kinds: [RENDER_ERROR_KIND.inputTooLarge],
      properties: {
        field: {
          type: "string",
          enum: Object.values(LIMITED_FIELD),
          description: "Set when a core limit is exceeded.",
        },
        limitBytes: { type: "integer", description: "Set when a core limit is exceeded." },
        message: { type: "string", description: "Set when the HTTP body limit is exceeded." },
      },
    }),
    503: errorSchema({
      description:
        "The worker is at capacity: every render slot is busy and the wait queue is full. Retry after `Retry-After` seconds.",
      kinds: [RENDER_ERROR_KIND.busy],
      properties: { retryAfterSeconds: { type: "integer" } },
      required: ["retryAfterSeconds"],
    }),
    415: errorSchema({
      description: "The content type is not supported, for example `application/xml`. Send `application/json`.",
      kinds: [RENDER_ERROR_KIND.invalidInput],
      properties: { message: { type: "string" } },
    }),
    422: errorSchema({
      description: "The template does not compile. Each diagnostic has the location and Typst's hints.",
      kinds: [RENDER_ERROR_KIND.compileFailed],
      properties: { diagnostics: { type: "array", items: { $ref: "Diagnostic#" } } },
      required: ["diagnostics"],
    }),
    500: errorSchema({
      description: "Unexpected server error. No internal details are returned.",
      kinds: [HTTP_ERROR_KIND.internal],
      properties: { message: { type: "string" } },
    }),
  },
} as const;

export const healthRouteSchema = {
  tags: ["health"],
  operationId: "health",
  summary: "Check that the server is running",
  description: "The server checks the Typst binary at startup and does not start without it.",
  response: {
    200: {
      description: "The server is running.",
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: [HEALTH_STATUS_OK] },
        typstVersion: { type: "string", description: "Typst version found at startup.", examples: ["0.15.1"] },
        renders: {
          type: "object",
          description: "Current load of the worker.",
          required: ["active", "queued", "maxConcurrent", "maxQueued"],
          properties: {
            active: { type: "integer", description: "Renders running now." },
            queued: { type: "integer", description: "Renders waiting for a free slot." },
            maxConcurrent: { type: "integer" },
            maxQueued: { type: "integer" },
          },
        },
      },
    },
  },
} as const;

/**
 * The top of the OpenAPI document: title, version, servers, security, and tags.
 * No `as const`: the @fastify/swagger types need mutable arrays.
 */
export const openapiInfo = {
  openapi: "3.1.0",
  info: {
    title: "docspawner API",
    version: "0.1.0",
    description:
      "Render a Typst template and JSON data to a PDF. The caller sends the full template in each request. docspawner stores nothing.",
  },
  servers: [{ url: "/", description: "The server that serves this document" }],
  // No authentication by design (ADR-0002): run docspawner inside a trusted network or behind a gateway.
  security: [],
  tags: [
    { name: "render", description: "Turn a template and data into a PDF." },
    { name: "health", description: "Service status." },
  ],
};
