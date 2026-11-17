// Outbound port: what the worker needs to turn Typst source into a PDF.
// The render service calls it. The Typst CLI adapter implements it.
import type { Diagnostic } from "../../../domain/render.js";

export interface CompileJob {
  /** Content of main.typ. */
  source: string;
  /** Extra files next to main.typ, for example { "data.json": bytes }. */
  files: Record<string, Uint8Array>;
  /** UNIX timestamp in seconds. */
  timestamp: number;
  timeoutMs: number;
}

/** Every way a compile can end. */
export const COMPILE_OUTCOME = {
  success: "success",
  failure: "failure",
  timeout: "timeout",
} as const;

export type CompileOutcome =
  | { kind: typeof COMPILE_OUTCOME.success; pdf: Uint8Array; warnings: Diagnostic[] }
  | { kind: typeof COMPILE_OUTCOME.failure; diagnostics: Diagnostic[] }
  | { kind: typeof COMPILE_OUTCOME.timeout };

export interface TypstCompiler {
  compile(job: CompileJob): Promise<CompileOutcome>;
  version(): Promise<string>;
}
