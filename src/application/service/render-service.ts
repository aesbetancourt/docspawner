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

export interface RenderServiceDeps {
  compiler: TypstCompiler;
  clock: Clock;
  slots: RenderSlots;
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
    async render(request: RenderRequest): Promise<RenderResult> {
      // 1. Check the input.
      const validated = validateRequest(request, limits);
      if (!validated.ok) {
        return validated;
      }

      const { source, dataJson, timeoutMs } = validated.value;
      const timestamp = validated.value.timestamp ?? Math.floor(deps.clock.now().getTime() / 1000);
      const started = deps.clock.now().getTime();

      // 2. Wait for a free slot, then compile.
      const slot = await deps.slots.run(() =>
        deps.compiler.compile({ source, files: { [DATA_FILE_NAME]: dataJson }, timestamp, timeoutMs }),
      );
      if (slot.kind === SLOT_RESULT.busy) {
        return { ok: false, error: { kind: RENDER_ERROR_KIND.busy, retryAfterSeconds: RETRY_AFTER_SECONDS } };
      }

      // 3. Turn the compile outcome into a render result.
      const durationMs = deps.clock.now().getTime() - started;
      return toResult(slot.value, { compiler: deps.compiler, durationMs, timeoutMs });
    },
  };
}

interface ResultContext {
  compiler: TypstCompiler;
  durationMs: number;
  timeoutMs: number;
}

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
