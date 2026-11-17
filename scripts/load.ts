// Send many render requests at once to a running docspawner worker and report the results.
// Usage: pnpm load [total] [concurrency] [url]
import { readFile } from "node:fs/promises";

const total = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 20);
const url = process.argv[4] ?? process.env.DOCSPAWNER_URL ?? "http://127.0.0.1:3000";

const template = await readFile(new URL("../examples/invoice/template.typ", import.meta.url), "utf8");
const data: unknown = JSON.parse(await readFile(new URL("../examples/invoice/data.json", import.meta.url), "utf8"));
const body = JSON.stringify({ template, data, options: { timestamp: 1_763_251_200 } });

const latencies: number[] = [];
const statuses = new Map<string, number>();
let sent = 0;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Send one request and record its status and latency. */
async function sendOne(): Promise<void> {
  const started = performance.now();
  let status: string;
  try {
    const response = await fetch(`${url}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await response.arrayBuffer();
    status = String(response.status);
  } catch (error) {
    status = `network error (${errorMessage(error)})`;
  }
  latencies.push(performance.now() - started);
  statuses.set(status, (statuses.get(status) ?? 0) + 1);
}

/** One client sends requests one after another until all `total` requests are sent. */
async function client(): Promise<void> {
  if (sent >= total) {
    return;
  }
  sent++;
  await sendOne();
  await client();
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => client()));
const seconds = (performance.now() - started) / 1000;

const sorted = latencies.toSorted((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

console.log(`${total} requests · concurrency ${concurrency} · ${url}`);
console.log(`throughput  ${(total / seconds).toFixed(1)} PDF/s in ${seconds.toFixed(1)} s`);
console.log(
  `latency     p50 ${pct(50).toFixed(0)} ms · p95 ${pct(95).toFixed(0)} ms · p99 ${pct(99).toFixed(0)} ms · max ${pct(100).toFixed(0)} ms`,
);
console.log(`status      ${[...statuses].map(([status, count]) => `${status}: ${count}`).join(" · ")}`);
