// Test helper: the render service wired with the real adapters, like main.ts but without HTTP.
import { systemClock } from "../../src/adapter/out/clock/system-clock.js";
import { TypstCliCompiler } from "../../src/adapter/out/typst/typst-cli-compiler.js";
import type { RenderDocument } from "../../src/application/port/in/render-document.js";
import { RenderSlots } from "../../src/application/service/render-slots.js";
import { createRenderService } from "../../src/application/service/render-service.js";

/**
 * Create the render service with the real Typst CLI, the system clock, and 4 render slots.
 * @returns The service, behind the `RenderDocument` port.
 */
export function createRealRenderer(): RenderDocument {
  return createRenderService({
    compiler: new TypstCliCompiler(),
    clock: systemClock,
    slots: new RenderSlots({ maxConcurrent: 4, maxQueued: 100 }),
  });
}
