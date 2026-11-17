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

/** The four layers of the hexagon. Startup code (main.ts, config.ts) is not a layer. */
type Layer = "domain" | "port" | "service" | "adapter";

/** What each layer can import: other layers, npm packages ("*" means any), and Node built-ins. */
const RULES: Record<Layer, { mayImport: Layer[]; packages: string[]; mayUseNode: boolean }> = {
  domain: { mayImport: ["domain"], packages: [], mayUseNode: false },
  port: { mayImport: ["domain", "port"], packages: [], mayUseNode: false },
  service: { mayImport: ["domain", "port", "service"], packages: [], mayUseNode: false },
  adapter: { mayImport: ["domain", "port", "adapter"], packages: ["*"], mayUseNode: true },
};

const SRC = resolve(import.meta.dirname, "../src");

/**
 * Find the layer of a file from its folder. main.ts and config.ts are startup code, not a layer.
 * @param file - An absolute path in src/.
 * @returns The layer, or `undefined` for startup code.
 */
function layerOf(file: string): Layer | undefined {
  const path = relative(SRC, file);
  if (path.startsWith("domain/")) return "domain";
  if (path.startsWith("application/port/")) return "port";
  if (path.startsWith("application/service/")) return "service";
  if (path.startsWith("adapter/")) return "adapter";
  return undefined;
}

/**
 * List every module that a file imports: static imports, re-exports, side-effect imports, and dynamic imports.
 * @param file - An absolute path to a TypeScript file.
 * @returns The import specifiers, for example "../domain/render.js" or "zod/v4".
 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const fromClauses = source.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gms);
  const sideEffects = source.matchAll(/^\s*import\s*["']([^"']+)["']/gm);
  const dynamic = source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g);
  return [...fromClauses, ...sideEffects, ...dynamic].map((match) => match[1]!);
}

/**
 * Tell whether an import is a Node built-in module. Built-ins do I/O, so only adapters can use them.
 * @param specifier - An import specifier.
 * @returns True for "node:fs", "fs", and the like.
 */
const isNodeBuiltin = (specifier: string) =>
  specifier.startsWith("node:") || builtinModules.includes(packageName(specifier));

/**
 * Get the package name of a bare import.
 * @param specifier - An import specifier that does not start with ".".
 * @returns For example "zod/v4" → "zod", "@fastify/swagger/x" → "@fastify/swagger".
 */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] ?? specifier;
}

/**
 * Check one import against the rule of its layer.
 * @param file - The file that has the import.
 * @param layer - The layer of that file.
 * @param specifier - The import specifier.
 * @returns A message that names the broken rule, or `undefined` when the import is allowed.
 */
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

/**
 * Check every import of a file.
 * @param file - An absolute path in src/.
 * @param layer - The layer of that file.
 * @returns One message per import that breaks the rule of the layer.
 */
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
