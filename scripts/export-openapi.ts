#!/usr/bin/env node
// Write the OpenAPI document to a file, or check that the file is up to date.
// Usage: node scripts/export-openapi.ts <output.json> [--check]   (run `pnpm build` first)
import { readFile, writeFile } from "node:fs/promises";
import type { RenderDocument } from "../dist/application/port/in/render-document.js";
import { buildApp } from "../dist/adapter/in/http/app.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const output = args.find((arg) => !arg.startsWith("--")) ?? "openapi.json";

// The document comes from the route schemas only. No render happens.
const renderer: RenderDocument = {
  render: () => Promise.reject(new Error("not used")),
};

const app = await buildApp({ renderer, docs: false });
await app.ready();
const document = JSON.stringify(app.swagger(), null, 2) + "\n";
await app.close();

if (check) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== document) {
    console.error(`${output} is out of date. Run \`pnpm openapi\` to update it.`);
    process.exit(1);
  }
  console.log(`${output} is up to date.`);
} else {
  await writeFile(output, document);
  console.log(`OpenAPI document written to ${output}`);
}
