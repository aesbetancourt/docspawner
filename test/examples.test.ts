// Every example in examples/ must render with the real Typst binary, with no errors and no warnings.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRealRenderer } from "./support/real-renderer.js";

const EXAMPLES = resolve(import.meta.dirname, "../examples");
const renderer = createRealRenderer();
const hash = (pdf: Uint8Array) => createHash("sha256").update(pdf).digest("hex");

const examples = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("examples", () => {
  it("has examples to test", () => {
    expect(examples).toEqual(expect.arrayContaining(["certificate-of-analysis", "cold-chain-shipment", "invoice"]));
  });

  for (const name of examples) {
    it(`${name} renders the same PDF twice, with no warnings`, async () => {
      const template = readFileSync(join(EXAMPLES, name, "template.typ"), "utf8");
      const data: unknown = JSON.parse(readFileSync(join(EXAMPLES, name, "data.json"), "utf8"));
      const request = { template, data, options: { timestamp: 1_763_251_200 } };

      const [first, second] = await Promise.all([renderer.render(request), renderer.render(request)]);
      if (!first.ok) {
        throw new Error(JSON.stringify(first.error));
      }
      if (!second.ok) {
        throw new Error(JSON.stringify(second.error));
      }

      expect(first.meta.warnings).toEqual([]);
      expect(hash(first.pdf)).toBe(hash(second.pdf));
    });
  }
});
