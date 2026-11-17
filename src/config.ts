import { availableParallelism } from "node:os";
import * as z from "zod/v4";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  TYPST_BIN: z.string().min(1).default("typst"),
  DOCSPAWNER_MAX_CONCURRENT_RENDERS: z.coerce.number().int().min(1).default(availableParallelism()),
  DOCSPAWNER_MAX_QUEUED_RENDERS: z.coerce.number().int().min(0).default(100),
  DOCSPAWNER_FONT_PATHS: z
    .string()
    .optional()
    .transform((value) => value?.split(":").filter(Boolean) ?? []),
});

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: (typeof LOG_LEVELS)[number];
  typstBinary: string;
  fontPaths: string[];
  maxConcurrentRenders: number;
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
    typstBinary: values.TYPST_BIN,
    fontPaths: values.DOCSPAWNER_FONT_PATHS,
    maxConcurrentRenders: values.DOCSPAWNER_MAX_CONCURRENT_RENDERS,
    maxQueuedRenders: values.DOCSPAWNER_MAX_QUEUED_RENDERS,
  };
}
