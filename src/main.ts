// Composition root: the only file that knows every part.
// It reads the settings, creates the adapters, connects them to the core, and starts the worker.
import { buildApp } from "./adapter/in/http/app.js";
import { createLoggerOptions } from "./adapter/in/http/logger.js";
import { systemClock } from "./adapter/out/clock/system-clock.js";
import { TypstCliCompiler } from "./adapter/out/typst/typst-cli-compiler.js";
import { RenderSlots } from "./application/service/render-slots.js";
import { createRenderService } from "./application/service/render-service.js";
import { loadConfig, type ServerConfig } from "./config.js";

// Below `stop_grace_period: 30s` in docker-compose.yml, so the worker exits before Docker sends SIGKILL.
const SHUTDOWN_TIMEOUT_MS = 25_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Get a readable message from anything that was thrown.
 * @param error - The thrown value. It is not always an `Error`.
 * @returns The error message, or the value as text.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
const compiler = new TypstCliCompiler({
  binary: config.typstBinary,
  fontPaths: config.fontPaths,
  packagePath: config.packagePath,
});
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
  logger: createLoggerOptions({ level: config.logLevel, format: config.logFormat }),
});

// 5. Graceful shutdown: stop accepting requests, let running and queued renders finish, then exit.
for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    app.log.info({ signal, ...slots.load() }, "shutting down");
    // `unref` lets the process exit before the timer when `app.close()` finishes first.
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
