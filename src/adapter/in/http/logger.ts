// Logger settings for Fastify, which logs with pino.
// `json` writes one JSON object per line, for log collectors.
// `pretty` writes one readable line per event, for a person who reads the terminal.
import pretty from "pino-pretty";

/** The two log formats. `LOG_FORMAT` in the environment selects one. */
export const LOG_FORMAT = { json: "json", pretty: "pretty" } as const;

/** `"json"` or `"pretty"`. */
export type LogFormat = (typeof LOG_FORMAT)[keyof typeof LOG_FORMAT];

/** What the logger needs from the server configuration. */
interface LoggerSettings {
  /** Lowest pino level to write, for example "info". */
  level: string;
  format: LogFormat;
}

/** The logger options that Fastify accepts. */
interface LoggerOptions {
  level: string;
  /** Present only for the `pretty` format. Without it, pino writes JSON to stdout. */
  stream?: pretty.PrettyStream;
}

/**
 * Build the Fastify logger options for a log format.
 * @param settings - The log level and the log format.
 * @returns The options to give to `buildApp` as `logger`.
 */
export function createLoggerOptions(settings: Readonly<LoggerSettings>): LoggerOptions {
  if (settings.format === LOG_FORMAT.json) {
    return { level: settings.level };
  }
  const stream = pretty({
    translateTime: "SYS:HH:MM:ss.l",
    // `prettyMessage` already puts these fields in the message.
    ignore: "pid,hostname,reqId,req,res,responseTime",
    singleLine: true,
    messageFormat: prettyMessage,
  });
  return { level: settings.level, stream };
}

/**
 * Format the message part of one pretty log line: request ID, message, request, and the status and time when it completes.
 * @param log - The pino log object.
 * @param messageKey - The key of the message in the log object, usually "msg".
 * @returns For example "req-3 request completed POST /render → 200 in 101 ms".
 */
export function prettyMessage(log: Record<string, unknown>, messageKey: string): string {
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
 * Tell whether a value is an object, so its fields can be read.
 * @param value - Any log field.
 * @returns True for a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Turn a log field into text. Pino log objects are untyped, so each field is checked first.
 * @param value - Any log field.
 * @returns The text of a string or a number, or "" for anything else.
 */
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}
