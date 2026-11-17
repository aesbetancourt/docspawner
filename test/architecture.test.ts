// Architecture test: the hexagon's dependency rule, checked on every import in src/.
//
//   adapter/in ──▶ application/port ◀── adapter/out
//                        ▲
//               application/service
//                        │
//                     domain  (everything may use the domain)
//
// Dependencies point inward. Adapters never import services, and the core never does I/O.
import { builtinModules } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Layer = "domain" | "port" | "service" | "adapter";

const RULES: Record<Layer, { mayImport: Layer[]; packages: string[]; mayUseNode: boolean }> = {
  domain: { mayImport: ["domain"], packages: [], mayUseNode: false },
  port: { mayImport: ["domain", "port"], packages: [], mayUseNode: false },
  service: { mayImport: ["domain", "port", "service"], packages: ["zod"], mayUseNode: false },
  adapter: { mayImport: ["domain", "port", "adapter"], packages: ["*"], mayUseNode: true },
};

const SRC = resolve(import.meta.dirname, "../src");

/** The layer of a file, from its folder. main.ts and config.ts are startup code, not a layer. */
function layerOf(file: string): Layer | undefined {
  const path = relative(SRC, file);
  if (path.startsWith("domain/")) return "domain";
  if (path.startsWith("application/port/")) return "port";
  if (path.startsWith("application/service/")) return "service";
  if (path.startsWith("adapter/")) return "adapter";
  return undefined;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const fromClauses = source.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gms);
  const sideEffects = source.matchAll(/^\s*import\s*["']([^"']+)["']/gm);
  const dynamic = source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g);
  return [...fromClauses, ...sideEffects, ...dynamic].map((match) => match[1]!);
}

const isNodeBuiltin = (specifier: string) =>
  specifier.startsWith("node:") || builtinModules.includes(packageName(specifier));

/** The package name of a bare import: "zod/v4" → "zod", "@fastify/swagger/x" → "@fastify/swagger". */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] ?? specifier;
}

/** The rule this one import breaks, if any. */
function violationOf(file: string, layer: Layer, specifier: string): string | undefined {
  const rule = RULES[layer];
  if (specifier.startsWith(".")) {
    const target = layerOf(resolve(dirname(file), specifier));
    if (!target) {
      return `${layer} must not import startup code: ${specifier}`;
    }
    if (!rule.mayImport.includes(target)) {
      return `${layer} must not import ${target}: ${specifier}`;
    }
    return undefined;
  }
  if (isNodeBuiltin(specifier)) {
    if (!rule.mayUseNode) {
      return `${layer} must not use ${specifier}: only adapters do I/O`;
    }
    return undefined;
  }
  const name = packageName(specifier);
  if (!rule.packages.includes("*") && !rule.packages.includes(name)) {
    return `${layer} must not use the package ${name}`;
  }
  return undefined;
}

/** Every import in `file` that breaks the rule of its layer. */
function violationsOf(file: string, layer: Layer): string[] {
  return importsOf(file)
    .map((specifier) => violationOf(file, layer, specifier))
    .filter((violation) => violation !== undefined);
}

const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .map((path) => join(SRC, path));

describe("hexagonal architecture", () => {
  it("has files in every layer", () => {
    const layers = new Set(files.map(layerOf).filter(Boolean));
    expect([...layers].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "adapter",
      "domain",
      "port",
      "service",
    ]);
  });

  for (const file of files) {
    const layer = layerOf(file);
    if (!layer) continue;

    it(`${relative(SRC, file)} (${layer}) only depends on allowed layers`, () => {
      expect(violationsOf(file, layer)).toEqual([]);
    });
  }
});
