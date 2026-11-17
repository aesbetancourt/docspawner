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

export interface AppOptions {
  /** The inbound port. The HTTP adapter calls the core only through this interface. */
  renderer: RenderDocument;
  /** Maximum request body in bytes. It must be larger than the core limits for template + data. */
  bodyLimit?: number;
  logger?: FastifyServerOptions["logger"];
  /** Serve Swagger UI at /docs and the OpenAPI document at /docs/json. Default: true. */
  docs?: boolean;
  /** Typst version found at startup. /health reports it. */
  typstVersion?: string;
  /** Current render load. /health reports it. */
  load?: () => RenderLoad;
}

const ROUTE = {
  render: "/render",
  health: "/health",
  docs: "/docs",
} as const;

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

/** The HTTP status for each core error. */
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

/** Register the OpenAPI document before the routes, so it sees every route. */
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

function schemaName(id: unknown, index: number): string {
  if (typeof id === "string") {
    return id;
  }
  return `def-${index}`;
}

function registerHealthRoute(app: FastifyInstance, options: AppOptions): void {
  app.get(ROUTE.health, { schema: healthRouteSchema }, async () => {
    const body: { status: typeof HEALTH_STATUS_OK; typstVersion?: string; renders?: RenderLoad } = {
      status: HEALTH_STATUS_OK,
    };
    if (options.typstVersion) {
      body.typstVersion = options.typstVersion;
    }
    if (options.load) {
      body.renders = options.load();
    }
    return body;
  });
}

function registerRenderRoute(app: FastifyInstance, renderer: RenderDocument): void {
  app.post<{ Body: RenderRequest }>(ROUTE.render, { schema: renderRouteSchema }, async (request, reply) => {
    const result = await renderer.render(request.body);
    return sendResult(reply, result);
  });
}

function sendResult(reply: FastifyReply, result: RenderResult): FastifyReply {
  if (!result.ok) {
    if (result.error.kind === RENDER_ERROR_KIND.busy) {
      reply.header(HEADER.retryAfter, String(result.error.retryAfterSeconds));
    }
    return reply.code(STATUS_BY_ERROR[result.error.kind]).send({ error: result.error });
  }

  return reply
    .header(HEADER.contentType, PDF_CONTENT_TYPE)
    .header(HEADER.contentDisposition, PDF_DISPOSITION)
    .header(HEADER.typstVersion, result.meta.typstVersion)
    .header(HEADER.durationMs, String(result.meta.durationMs))
    .header(HEADER.warnings, String(result.meta.warnings.length))
    .send(Buffer.from(result.pdf.buffer, result.pdf.byteOffset, result.pdf.byteLength));
}

/** Give unknown routes and Fastify's own errors the same `{ error: { kind, message } }` shape. */
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

function clientErrorKind(statusCode: number): RenderErrorKind {
  if (statusCode === 413) {
    return RENDER_ERROR_KIND.inputTooLarge;
  }
  return RENDER_ERROR_KIND.invalidInput;
}
