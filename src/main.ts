// Composition root: the only file that knows every part.
// It reads the settings, creates the adapters, connects them to the core, and starts the worker.
import { buildApp } from "./adapter/in/http/app.js";
import { systemClock } from "./adapter/out/clock/system-clock.js";
import { TypstCliCompiler, type TypstCliOptions } from "./adapter/out/typst/typst-cli-compiler.js";
import { RenderSlots } from "./application/service/render-slots.js";
import { createRenderService } from "./application/service/render-service.js";
import { loadConfig, type ServerConfig } from "./config.js";

const SHUTDOWN_TIMEOUT_MS = 25_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

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
const typstOptions: TypstCliOptions = { binary: config.typstBinary, fontPaths: config.fontPaths };
if (config.packagePath) {
  typstOptions.packagePath = config.packagePath;
}
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
  logger: { level: config.logLevel },
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
