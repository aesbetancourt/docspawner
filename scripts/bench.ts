// Measure render time for the example invoice through the render service, without HTTP.
// Usage: pnpm bench [runs]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { systemClock } from "../dist/adapter/out/clock/system-clock.js";
import { TypstCliCompiler } from "../dist/adapter/out/typst/typst-cli-compiler.js";
import { RenderSlots } from "../dist/application/service/render-slots.js";
import { createRenderService } from "../dist/application/service/render-service.js";

const runs = Number(process.argv[2] ?? 50);
const warmup = 3;

const template = await readFile(new URL("../examples/invoice/template.typ", import.meta.url), "utf8");
const data: { items: unknown[] } = JSON.parse(
  await readFile(new URL("../examples/invoice/data.json", import.meta.url), "utf8"),
);
const renderer = createRenderService({
  // The invoice imports allowlisted packages; `pnpm packages` installs them here.
  compiler: new TypstCliCompiler({ packagePath: fileURLToPath(new URL("../typst-packages", import.meta.url)) }),
  clock: systemClock,
  slots: new RenderSlots({ maxConcurrent: 1, maxQueued: 0 }),
});

const times: number[] = [];
let pdfBytes = 0;
let version = "";

/**
 * Render the invoice once and record the time. Warmup runs are not recorded.
 * @param index - The number of the run, from 0. Runs below `warmup` are warmup runs.
 * @throws Error when the render fails.
 */
async function measure(index: number): Promise<void> {
  const started = performance.now();
  const result = await renderer.render({ template, data, options: { timestamp: 1_763_251_200 } });
  const elapsed = performance.now() - started;

  if (!result.ok) {
    throw new Error(`render failed: ${JSON.stringify(result.error)}`);
  }
  if (index >= warmup) {
    times.push(elapsed);
  }
  pdfBytes = result.pdf.byteLength;
  version = result.meta.typstVersion;
}

// Renders run one after another on purpose: a measurement must not compete with another render.
await Array.from({ length: warmup + runs }, (_, index) => index).reduce(
  (previous, index) => previous.then(() => measure(index)),
  Promise.resolve(),
);

const sorted = times.toSorted((a, b) => a - b);
/** The p-th percentile of the sorted times, in milliseconds. */
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const mean = sorted.reduce((sum, t) => sum + t, 0) / sorted.length;

console.log(`Typst ${version} · invoice with ${data.items.length} items · ${runs} runs (+${warmup} warmup)`);
console.log(`p50  ${pct(50).toFixed(1)} ms`);
console.log(`p95  ${pct(95).toFixed(1)} ms`);
console.log(`mean ${mean.toFixed(1)} ms`);
console.log(`PDF  ${(pdfBytes / 1024).toFixed(1)} KiB`);
