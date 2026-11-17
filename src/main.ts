// Composition root: the only file that knows every part.
// It reads the settings, creates the adapters, connects them to the core, and starts the worker.
import { buildApp } from "./adapter/in/http/app.js";
import { systemClock } from "./adapter/out/clock/system-clock.js";
import { TypstCliCompiler, type TypstCliOptions } from "./adapter/out/typst/typst-cli-compiler.js";
import { RenderSlots } from "./application/service/render-slots.js";
import { createRenderService } from "./application/service/render-service.js";
import { LOG_FORMAT, loadConfig, type ServerConfig } from "./config.js";
import pretty from "pino-pretty";

const SHUTDOWN_TIMEOUT_MS = 25_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

/**
 * Format one log line for people: request ID, message, request, and the status and time when it completes.
 * @param log - The pino log object.
 * @param messageKey - The key of the message in the log object.
 * @returns The message part of the line, for example "req-3 request completed POST /render → 200 in 101 ms".
 */
function prettyMessage(log: Record<string, unknown>, messageKey: string): string {
  const parts = [text(log.reqId), text(log[messageKey])];
  if (isRecord(log.req)) {
    parts.push(text(log.req.method), text(log.req.url));
  }
  if (isRecord(log.res) && typeof log.responseTime === "number") {
    parts.push(`→ ${text(log.res.statusCode)} in ${log.responseTime.toFixed(0)} ms`);
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Build the Fastify logger options: JSON lines, or one readable line per event.
 * @param settings - The server configuration.
 * @returns The logger options for Fastify.
 */
function loggerOptions(settings: ServerConfig): { level: string; stream?: pretty.PrettyStream } {
  if (settings.logFormat === LOG_FORMAT.json) {
    return { level: settings.logLevel };
  }
  const stream = pretty({
    translateTime: "SYS:HH:MM:ss.l",
    ignore: "pid,hostname,reqId,req,res,responseTime",
    singleLine: true,
    messageFormat: prettyMessage,
  });
  return { level: settings.logLevel, stream };
}

// 1. Read the settings. Stop with a clear message if one is invalid.
let config: ServerConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

// 2. Create the driven adapter for Typst. Stop if the Typst binary does not run.
const typstOptions: TypstCliOptions = {
  binary: config.typstBinary,
  fontPaths: config.fontPaths,
  packagePath: config.packagePath,
};
const compiler = new TypstCliCompiler(typstOptions);
let typstVersion: string;
try {
  typstVersion = await compiler.version();
} catch (error) {
  console.error(`Cannot run the Typst binary "${config.typstBinary}". Install Typst or set TYPST_BIN.`);
  console.error(errorMessage(error));
  process.exit(1);
}

// 3. Create the core: the render service, with its render slots (ADR-0011).
const slots = new RenderSlots({ maxConcurrent: config.maxConcurrentRenders, maxQueued: config.maxQueuedRenders });
const renderer = createRenderService({ compiler, clock: systemClock, slots });

// 4. Create the driving adapter: the HTTP server.
const app = await buildApp({
  renderer,
  typstVersion,
  load: () => slots.load(),
  logger: loggerOptions(config),
});

// 5. Graceful shutdown: stop accepting requests, let running and queued renders finish, then exit.
for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    app.log.info({ signal, ...slots.load() }, "shutting down");
    setTimeout(() => {
      app.log.error("renders did not finish in time; exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    void app.close().then(() => process.exit(0));
  });
}

// 6. Start the worker.
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info({ typstVersion, ...slots.load() }, "docspawner is ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
