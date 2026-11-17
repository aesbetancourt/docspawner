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

const mb = (bytes: number) => `${bytes / 1_000_000} MB`;
const { maxTemplateBytes, maxDataBytes, defaultTimeoutMs, maxTimeoutMs } = DEFAULT_LIMITS;

const EXAMPLE_TEMPLATE = '#let data = json("data.json")\n= Invoice #data.number\nCustomer: #data.customer';

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

function errorSchema(
  description: string,
  kind: readonly string[],
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    description,
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["kind", ...required],
        properties: { kind: { type: "string", enum: kind }, ...properties },
      },
    },
  } as const;
}

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
    "Only fonts embedded in Typst are available. Typst packages are not downloaded from the network.",
  ].join("\n"),
  body: { $ref: "RenderRequest#" },
  response: {
    200: {
      description: "The rendered PDF.",
      headers: PDF_HEADERS,
      content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
    },
    400: errorSchema(
      "The request is not valid: a missing field, a wrong type, or an empty template.",
      [RENDER_ERROR_KIND.invalidInput],
      {
        message: { type: "string" },
      },
    ),
    408: errorSchema(
      "The compile took more than `timeoutMs`. Typst was stopped.",
      [RENDER_ERROR_KIND.timeout],
      {
        timeoutMs: { type: "integer" },
      },
      ["timeoutMs"],
    ),
    413: errorSchema(
      "The template, the data, or the request body is above its size limit.",
      [RENDER_ERROR_KIND.inputTooLarge],
      {
        field: {
          type: "string",
          enum: Object.values(LIMITED_FIELD),
          description: "Set when a core limit is exceeded.",
        },
        limitBytes: { type: "integer", description: "Set when a core limit is exceeded." },
        message: { type: "string", description: "Set when the HTTP body limit is exceeded." },
      },
    ),
    503: errorSchema(
      "The worker is at capacity: every render slot is busy and the wait queue is full. Retry after `Retry-After` seconds.",
      [RENDER_ERROR_KIND.busy],
      { retryAfterSeconds: { type: "integer" } },
      ["retryAfterSeconds"],
    ),
    415: errorSchema(
      "The content type is not supported, for example `application/xml`. Send `application/json`.",
      [RENDER_ERROR_KIND.invalidInput],
      {
        message: { type: "string" },
      },
    ),
    422: errorSchema(
      "The template does not compile. Each diagnostic has the location and Typst's hints.",
      [RENDER_ERROR_KIND.compileFailed],
      {
        diagnostics: { type: "array", items: { $ref: "Diagnostic#" } },
      },
      ["diagnostics"],
    ),
    500: errorSchema("Unexpected server error. No internal details are returned.", [HTTP_ERROR_KIND.internal], {
      message: { type: "string" },
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
