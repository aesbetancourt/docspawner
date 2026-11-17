// The render use case: validate the request, wait for a slot, compile, and map the outcome.
// It does no I/O itself. It reaches Typst and the clock only through the outbound ports.
import {
  DATA_FILE_NAME,
  DEFAULT_LIMITS,
  RENDER_ERROR_KIND,
  type RenderLimits,
  type RenderRequest,
  type RenderResult,
} from "../../domain/render.js";
import type { RenderDocument } from "../port/in/render-document.js";
import type { Clock } from "../port/out/clock.js";
import { COMPILE_OUTCOME, type CompileOutcome, type TypstCompiler } from "../port/out/typst-compiler.js";
import { SLOT_RESULT, type RenderSlots } from "./render-slots.js";
import { validateRequest } from "./validate-request.js";

/** Seconds a caller waits before it retries when the worker is busy. */
const RETRY_AFTER_SECONDS = 1;

/** What the render service needs. `main.ts` gives the real adapters. Tests give fakes. */
export interface RenderServiceDeps {
  /** Turns Typst source into a PDF. */
  compiler: TypstCompiler;
  /** Gives the default document timestamp and measures the render time. */
  clock: Clock;
  /** Limits how many renders run at once. */
  slots: RenderSlots;
  /** Overrides for `DEFAULT_LIMITS`. */
  limits?: Partial<RenderLimits>;
}

/**
 * Create the render service. It implements the inbound port and calls the outbound ports.
 * @param deps - The Typst compiler, the clock, the render slots, and optional limits.
 * @returns The service, behind the `RenderDocument` port.
 */
export function createRenderService(deps: RenderServiceDeps): RenderDocument {
  const limits: RenderLimits = { ...DEFAULT_LIMITS, ...deps.limits };

  return {
    /**
     * Render one request. See `RenderDocument.render`.
     * @param request - The template, the data, and optional settings.
     * @returns The PDF and its metadata, or an expected error.
     * @throws Error when the compiler has a real fault.
     */
    async render(request: RenderRequest): Promise<RenderResult> {
      // 1. Check the input.
      const validated = validateRequest(request, limits);
      if (!validated.ok) {
        return validated;
      }

      const { source, dataJson, timeoutMs } = validated.value;
      const startedMs = deps.clock.now().getTime();
      const timestamp = validated.value.timestamp ?? Math.floor(startedMs / 1000);

      // 2. Wait for a free slot, then compile.
      const slot = await deps.slots.run(() =>
        deps.compiler.compile({ source, files: { [DATA_FILE_NAME]: dataJson }, timestamp, timeoutMs }),
      );
      if (slot.kind === SLOT_RESULT.busy) {
        return { ok: false, error: { kind: RENDER_ERROR_KIND.busy, retryAfterSeconds: RETRY_AFTER_SECONDS } };
      }

      // 3. Turn the compile outcome into a render result.
      const durationMs = deps.clock.now().getTime() - startedMs;
      return toResult(slot.value, { compiler: deps.compiler, durationMs, timeoutMs });
    },
  };
}

/** What `toResult` needs besides the compile outcome. */
interface ResultContext {
  compiler: TypstCompiler;
  durationMs: number;
  timeoutMs: number;
}

/**
 * Map a compile outcome (the language of the outbound port) to a render result (the language of the inbound port).
 * @param outcome - How the compile ended.
 * @param context - The compiler, for its version, and the times to report.
 * @returns The PDF with its metadata, a `compile_failed` error, or a `timeout` error.
 */
async function toResult(outcome: CompileOutcome, context: Readonly<ResultContext>): Promise<RenderResult> {
  if (outcome.kind === COMPILE_OUTCOME.success) {
    const typstVersion = await context.compiler.version();
    return {
      ok: true,
      pdf: outcome.pdf,
      meta: { typstVersion, durationMs: context.durationMs, warnings: outcome.warnings },
    };
  }
  if (outcome.kind === COMPILE_OUTCOME.failure) {
    return { ok: false, error: { kind: RENDER_ERROR_KIND.compileFailed, diagnostics: outcome.diagnostics } };
  }
  return { ok: false, error: { kind: RENDER_ERROR_KIND.timeout, timeoutMs: context.timeoutMs } };
}
