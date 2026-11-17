// Driving adapter: turns HTTP requests into calls to the `RenderDocument` port, and results into HTTP responses.
// It knows HTTP status codes and headers. The core does not.
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import {
  RENDER_ERROR_KIND,
  type RenderErrorKind,
  type RenderLoad,
  type RenderRequest,
  type RenderResult,
} from "../../../domain/render.js";
import type { RenderDocument } from "../../../application/port/in/render-document.js";
import {
  BODY_LIMIT_BYTES,
  diagnosticSchema,
  HEALTH_STATUS_OK,
  HTTP_ERROR_KIND,
  healthRouteSchema,
  openapiInfo,
  renderRequestSchema,
  renderRouteSchema,
} from "./schemas.js";

/** What the HTTP adapter needs. `main.ts` gives the real values. Tests give fakes. */
export interface AppOptions {
  /** The inbound port. The HTTP adapter calls the core only through this interface. */
  renderer: RenderDocument;
  /** Maximum request body in bytes. It must be larger than the core limits for template + data. */
  bodyLimit?: number;
  /** Fastify logger options. Default: no logs. */
  logger?: FastifyServerOptions["logger"];
  /** Serve Swagger UI at /docs and the OpenAPI document at /docs/json. Default: true. */
  docs?: boolean;
  /** Typst version found at startup. /health reports it. */
  typstVersion?: string;
  /** Current render load. /health reports it. */
  load?: () => RenderLoad;
}

/** The URL paths the worker serves. */
const ROUTE = {
  render: "/render",
  health: "/health",
  docs: "/docs",
} as const;

/** The HTTP headers the worker sets. */
const HEADER = {
  contentType: "content-type",
  contentDisposition: "content-disposition",
  retryAfter: "retry-after",
  typstVersion: "x-typst-version",
  durationMs: "x-render-duration-ms",
  warnings: "x-typst-warnings",
} as const;

const PDF_CONTENT_TYPE = "application/pdf";
// "attachment" makes browsers and Swagger UI offer the PDF as a file download.
const PDF_DISPOSITION = 'attachment; filename="document.pdf"';

/** The HTTP status for each core error. `Record` makes TypeScript fail when a new error kind has no status. */
const STATUS_BY_ERROR: Record<RenderErrorKind, number> = {
  [RENDER_ERROR_KIND.invalidInput]: 400,
  [RENDER_ERROR_KIND.inputTooLarge]: 413,
  [RENDER_ERROR_KIND.compileFailed]: 422,
  [RENDER_ERROR_KIND.timeout]: 408,
  [RENDER_ERROR_KIND.busy]: 503,
};

/**
 * Build the HTTP adapter: HTTP request → `RenderDocument` port → HTTP response.
 * @param options - The render port, and HTTP settings.
 * @returns A Fastify app that is ready to `listen` or `inject`.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? BODY_LIMIT_BYTES,
  });

  await registerDocs(app, options.docs ?? true);
  registerHealthRoute(app, options);
  registerRenderRoute(app, options.renderer);
  registerErrorHandlers(app);
  return app;
}

/**
 * Register the OpenAPI document and, optionally, Swagger UI. It must run before the routes, so it sees every route.
 * @param app - The Fastify app.
 * @param withUi - Serve Swagger UI at /docs.
 */
async function registerDocs(app: FastifyInstance, withUi: boolean): Promise<void> {
  await app.register(swagger, {
    openapi: openapiInfo,
    // Name shared schemas by their $id ("Diagnostic"), not "def-0".
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => schemaName(json.$id, i) },
  });
  if (withUi) {
    await app.register(swaggerUi, { routePrefix: ROUTE.docs, uiConfig: { docExpansion: "list", deepLinking: true } });
  }
  app.addSchema(diagnosticSchema);
  app.addSchema(renderRequestSchema);
}

/**
 * Name a shared schema in the OpenAPI document.
 * @param id - The `$id` of the schema, for example "Diagnostic".
 * @param index - The position of the schema, for a schema with no `$id`.
 * @returns The `$id`, or "def-<index>".
 */
function schemaName(id: unknown, index: number): string {
  if (typeof id === "string") {
    return id;
  }
  return `def-${index}`;
}

/** The body of a `/health` response. */
interface HealthBody {
  status: typeof HEALTH_STATUS_OK;
  typstVersion?: string;
  renders?: RenderLoad;
}

/**
 * Register `GET /health`: the status, the Typst version, and the current load.
 * @param app - The Fastify app.
 * @param options - The Typst version and the load function, when given.
 */
function registerHealthRoute(app: FastifyInstance, options: AppOptions): void {
  app.get(ROUTE.health, { schema: healthRouteSchema }, async () => {
    const body: HealthBody = { status: HEALTH_STATUS_OK };
    if (options.typstVersion) {
      body.typstVersion = options.typstVersion;
    }
    if (options.load) {
      body.renders = options.load();
    }
    return body;
  });
}

/**
 * Register `POST /render`. Fastify checks the body against the JSON Schema before the handler runs.
 * @param app - The Fastify app.
 * @param renderer - The inbound port.
 */
function registerRenderRoute(app: FastifyInstance, renderer: RenderDocument): void {
  app.post<{ Body: RenderRequest }>(ROUTE.render, { schema: renderRouteSchema }, async (request, reply) => {
    const result = await renderer.render(request.body);
    return sendResult(reply, result);
  });
}

/**
 * Send a render result: the PDF with metadata headers, or the error with its status code.
 * @param reply - The Fastify reply.
 * @param result - The result from the render service.
 * @returns The reply, after `send`.
 */
function sendResult(reply: FastifyReply, result: RenderResult): FastifyReply {
  if (!result.ok) {
    if (result.error.kind === RENDER_ERROR_KIND.busy) {
      reply.header(HEADER.retryAfter, String(result.error.retryAfterSeconds));
    }
    return reply.code(STATUS_BY_ERROR[result.error.kind]).send({ error: result.error });
  }

  return (
    reply
      .header(HEADER.contentType, PDF_CONTENT_TYPE)
      .header(HEADER.contentDisposition, PDF_DISPOSITION)
      .header(HEADER.typstVersion, result.meta.typstVersion)
      .header(HEADER.durationMs, String(result.meta.durationMs))
      .header(HEADER.warnings, String(result.meta.warnings.length))
      // A Buffer view on the same memory: no copy of the PDF.
      .send(Buffer.from(result.pdf.buffer, result.pdf.byteOffset, result.pdf.byteLength))
  );
}

/**
 * Give unknown routes and Fastify's own errors the same `{ error: { kind, message } }` shape.
 * A 500 hides the details from the caller and logs them.
 * @param app - The Fastify app.
 */
function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { kind: HTTP_ERROR_KIND.notFound, message: `${request.method} ${request.url} does not exist` },
    }),
  );

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: { kind: HTTP_ERROR_KIND.internal, message: "internal error" } });
    }
    // Fastify's own errors: schema validation (400), body too large (413), wrong content type (415).
    return reply.code(statusCode).send({ error: { kind: clientErrorKind(statusCode), message: error.message } });
  });
}

/**
 * Pick the error kind for a client error that Fastify found before the handler ran.
 * @param statusCode - A 4xx status from Fastify.
 * @returns `input_too_large` for 413, else `invalid_input`.
 */
function clientErrorKind(statusCode: number): RenderErrorKind {
  if (statusCode === 413) {
    return RENDER_ERROR_KIND.inputTooLarge;
  }
  return RENDER_ERROR_KIND.invalidInput;
}
