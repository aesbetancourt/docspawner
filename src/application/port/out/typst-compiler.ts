// Outbound port: what the worker needs to turn Typst source into a PDF.
// The render service calls it. The Typst CLI adapter implements it.
import type { Diagnostic } from "../../../domain/render.js";

/** One compile: everything the compiler needs, and nothing about HTTP or validation. */
export interface CompileJob {
  /** Content of main.typ. */
  source: string;
  /** Extra files next to main.typ, for example { "data.json": bytes }. */
  files: Record<string, Uint8Array>;
  /** UNIX timestamp in seconds. */
  timestamp: number;
  /** The compiler stops the compile after this time. */
  timeoutMs: number;
}

/** Every way a compile can end. */
export const COMPILE_OUTCOME = {
  success: "success",
  failure: "failure",
  timeout: "timeout",
} as const;

/** The result of one compile. The render service turns it into a `RenderResult`. */
export type CompileOutcome =
  | { kind: typeof COMPILE_OUTCOME.success; pdf: Uint8Array; warnings: Diagnostic[] }
  | { kind: typeof COMPILE_OUTCOME.failure; diagnostics: Diagnostic[] }
  | { kind: typeof COMPILE_OUTCOME.timeout };

/** A Typst compiler. The core does not know whether it is a CLI, a library, or a fake. */
export interface TypstCompiler {
  /**
   * Compile one job to a PDF.
   * @param job - The source, the extra files, the timestamp, and the timeout.
   * @returns The PDF, the errors, or a timeout.
   * @throws Error for a real fault, for example when the compiler cannot start.
   */
  compile(job: CompileJob): Promise<CompileOutcome>;

  /**
   * Get the version of the compiler.
   * @returns The version number, for example "0.15.1".
   * @throws Error when the compiler cannot run.
   */
  version(): Promise<string>;
}
