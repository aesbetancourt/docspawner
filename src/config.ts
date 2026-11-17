// Server settings from environment variables. Startup code: it may import anything, and only main.ts imports it.
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { LOG_FORMAT, type LogFormat } from "./adapter/in/http/logger.js";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

// `pnpm packages` installs the allowlist here. The Docker image sets its own folder.
const REPO_PACKAGE_PATH = fileURLToPath(new URL("../typst-packages", import.meta.url));

/** Every environment variable the worker reads, with its type and default. Strings are coerced to numbers. */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  LOG_FORMAT: z.enum(LOG_FORMAT).default(LOG_FORMAT.json),
  TYPST_BIN: z.string().min(1).default("typst"),
  DOCSPAWNER_MAX_CONCURRENT_RENDERS: z.coerce.number().int().min(1).default(availableParallelism()),
  DOCSPAWNER_MAX_QUEUED_RENDERS: z.coerce.number().int().min(0).default(100),
  DOCSPAWNER_PACKAGE_PATH: z.string().min(1).default(REPO_PACKAGE_PATH),
  DOCSPAWNER_FONT_PATHS: z
    .string()
    .optional()
    .transform((value) => value?.split(":").filter(Boolean) ?? []),
});

/** The settings, with readable names. `main.ts` uses them to build every part. */
export interface ServerConfig {
  /** TCP port of the HTTP server. */
  port: number;
  /** Address to listen on. "0.0.0.0" in a container. */
  host: string;
  logLevel: (typeof LOG_LEVELS)[number];
  logFormat: LogFormat;
  /** Path or name of the Typst binary. */
  typstBinary: string;
  /** Extra font folders, from a colon-separated list. */
  fontPaths: string[];
  /** Folder with the pre-installed Typst packages from the allowlist (ADR-0012). */
  packagePath: string;
  /** Render slots (ADR-0011). Default: the number of CPUs. */
  maxConcurrentRenders: number;
  /** Renders that can wait for a slot before the worker returns 503. */
  maxQueuedRenders: number;
}

/**
 * Read the server configuration from environment variables.
 * @param env - The environment, usually `process.env`.
 * @returns The configuration, with defaults for every unset variable.
 * @throws Error that lists every invalid variable.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(["Invalid configuration:", ...problems].join("\n"));
  }

  const values = parsed.data;
  return {
    port: values.PORT,
    host: values.HOST,
    logLevel: values.LOG_LEVEL,
    logFormat: values.LOG_FORMAT,
    typstBinary: values.TYPST_BIN,
    fontPaths: values.DOCSPAWNER_FONT_PATHS,
    packagePath: values.DOCSPAWNER_PACKAGE_PATH,
    maxConcurrentRenders: values.DOCSPAWNER_MAX_CONCURRENT_RENDERS,
    maxQueuedRenders: values.DOCSPAWNER_MAX_QUEUED_RENDERS,
  };
}
