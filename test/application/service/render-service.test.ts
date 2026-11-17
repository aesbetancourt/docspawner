import { describe, expect, it } from "vitest";
import type { Clock } from "../../../src/application/port/out/clock.js";
import type { CompileJob, CompileOutcome, TypstCompiler } from "../../../src/application/port/out/typst-compiler.js";
import { RenderSlots } from "../../../src/application/service/render-slots.js";
import { createRenderService } from "../../../src/application/service/render-service.js";

/** New render slots for each test, so tests do not share a queue. */
const slots = () => new RenderSlots({ maxConcurrent: 1, maxQueued: 10 });

const fixedClock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const FIXED_SECONDS = Date.UTC(2026, 0, 1) / 1000;

/**
 * A fake outbound port that returns a fixed outcome and records each job. It needs no Typst binary.
 * @param outcome - The outcome every compile returns.
 * @returns The fake, with `jobs` for the jobs it received.
 */
function fakeCompiler(outcome: CompileOutcome): TypstCompiler & { jobs: CompileJob[] } {
  const jobs: CompileJob[] = [];
  return {
    jobs,
    async compile(job) {
      jobs.push(job);
      return outcome;
    },
    async version() {
      return "0.0.0-test";
    },
  };
}

const pdf = new Uint8Array([1, 2, 3]);

describe("render service", () => {
  it("sends the template and data.json to the compiler and returns the PDF", async () => {
    const compiler = fakeCompiler({ kind: "success", pdf, warnings: [] });
    const result = await createRenderService({ compiler, clock: fixedClock, slots: slots() }).render({
      template: "= Hi",
      data: { name: "Ana" },
    });

    expect(result).toMatchObject({ ok: true, pdf, meta: { typstVersion: "0.0.0-test", warnings: [] } });
    const job = compiler.jobs[0]!;
    expect(job.source).toBe("= Hi");
    expect(new TextDecoder().decode(job.files["data.json"])).toBe('{"name":"Ana"}');
  });

  it("uses the clock when the caller sends no timestamp", async () => {
    const compiler = fakeCompiler({ kind: "success", pdf, warnings: [] });
    await createRenderService({ compiler, clock: fixedClock, slots: slots() }).render({ template: "x", data: {} });
    expect(compiler.jobs[0]!.timestamp).toBe(FIXED_SECONDS);
  });

  it("uses the caller timestamp when it is sent", async () => {
    const compiler = fakeCompiler({ kind: "success", pdf, warnings: [] });
    await createRenderService({ compiler, clock: fixedClock, slots: slots() }).render({
      template: "x",
      data: {},
      options: { timestamp: 42 },
    });
    expect(compiler.jobs[0]!.timestamp).toBe(42);
  });

  it("maps a compile failure to compile_failed", async () => {
    const diagnostics = [{ severity: "error" as const, message: "boom", line: 1, column: 1 }];
    const result = await createRenderService({
      compiler: fakeCompiler({ kind: "failure", diagnostics }),
      clock: fixedClock,
      slots: slots(),
    }).render({ template: "x", data: {} });
    expect(result).toEqual({ ok: false, error: { kind: "compile_failed", diagnostics } });
  });

  it("maps a timeout to a timeout error with the limit used", async () => {
    const result = await createRenderService({
      compiler: fakeCompiler({ kind: "timeout" }),
      clock: fixedClock,
      slots: slots(),
    }).render({
      template: "x",
      data: {},
      options: { timeoutMs: 500 },
    });
    expect(result).toEqual({ ok: false, error: { kind: "timeout", timeoutMs: 500 } });
  });

  it("does not call the compiler when the input is invalid", async () => {
    const compiler = fakeCompiler({ kind: "success", pdf, warnings: [] });
    const result = await createRenderService({ compiler, clock: fixedClock, slots: slots() }).render({
      template: "",
      data: {},
    });
    expect(result.ok).toBe(false);
    expect(compiler.jobs).toHaveLength(0);
  });

  it("returns busy with Retry-After seconds when every slot is taken and the queue is full", async () => {
    const neverFinishes: TypstCompiler = { compile: () => new Promise(() => {}), version: async () => "test" };
    const service = createRenderService({
      compiler: neverFinishes,
      clock: fixedClock,
      slots: new RenderSlots({ maxConcurrent: 1, maxQueued: 0 }),
    });

    void service.render({ template: "x", data: {} }); // takes the only slot
    const result = await service.render({ template: "x", data: {} });
    expect(result).toEqual({ ok: false, error: { kind: "busy", retryAfterSeconds: 1 } });
  });
});
