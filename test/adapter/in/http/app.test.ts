import type { RenderDocument } from "../../../../src/application/port/in/render-document.js";
import type { RenderError, RenderResult } from "../../../../src/domain/render.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../../src/adapter/in/http/app.js";
import { createRealRenderer } from "../../../support/real-renderer.js";

function fakeRenderer(result: RenderResult): RenderDocument & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async render(request) {
      calls.push(request);
      return result;
    },
  };
}

const pdf = new TextEncoder().encode("%PDF-fake");
const success: RenderResult = { ok: true, pdf, meta: { typstVersion: "9.9.9", durationMs: 12, warnings: [] } };

describe("POST /render", () => {
  it("returns the PDF with metadata headers", async () => {
    const renderer = fakeRenderer(success);
    const response = await (
      await buildApp({ renderer })
    ).inject({
      method: "POST",
      url: "/render",
      payload: { template: "= Hi", data: { a: 1 }, options: { timestamp: 5 } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="document.pdf"');
    expect(response.headers["x-typst-version"]).toBe("9.9.9");
    expect(response.headers["x-render-duration-ms"]).toBe("12");
    expect(response.rawPayload.toString()).toBe("%PDF-fake");
    expect(renderer.calls[0]).toEqual({ template: "= Hi", data: { a: 1 }, options: { timestamp: 5 } });
  });

  it.each([
    [{ kind: "invalid_input", message: "bad" }, 400],
    [{ kind: "input_too_large", field: "data", limitBytes: 10 }, 413],
    [{ kind: "compile_failed", diagnostics: [{ severity: "error", message: "x", line: 1, column: 1 }] }, 422],
    [{ kind: "timeout", timeoutMs: 100 }, 408],
    [{ kind: "busy", retryAfterSeconds: 1 }, 503],
  ] satisfies [RenderError, number][])("maps %o to HTTP %i", async (error, status) => {
    const response = await (
      await buildApp({ renderer: fakeRenderer({ ok: false, error }) })
    ).inject({
      method: "POST",
      url: "/render",
      payload: { template: "x", data: {} },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error });
  });

  it("returns 400 when a required field is missing", async () => {
    const renderer = fakeRenderer(success);
    const response = await (
      await buildApp({ renderer })
    ).inject({ method: "POST", url: "/render", payload: { template: "x" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { kind: "invalid_input" } });
    expect(renderer.calls).toHaveLength(0);
  });

  it("returns 413 when the body is above the limit", async () => {
    const response = await (
      await buildApp({ renderer: fakeRenderer(success), bodyLimit: 100 })
    ).inject({
      method: "POST",
      url: "/render",
      payload: { template: "x".repeat(200), data: {} },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { kind: "input_too_large" } });
  });

  it("returns 500 with no internal details when the renderer throws", async () => {
    const renderer: RenderDocument = {
      render: async () => {
        throw new Error("secret detail");
      },
    };
    const response = await (
      await buildApp({ renderer })
    ).inject({
      method: "POST",
      url: "/render",
      payload: { template: "x", data: {} },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret");
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await (
      await buildApp({ renderer: fakeRenderer(success) })
    ).inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("reports the render load", async () => {
    const load = { active: 1, queued: 3, maxConcurrent: 2, maxQueued: 100 };
    const app = await buildApp({ renderer: fakeRenderer(success), load: () => load });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok", renders: load });
  });

  it("reports the Typst version found at startup", async () => {
    const app = await buildApp({ renderer: fakeRenderer(success), typstVersion: "0.15.1" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok", typstVersion: "0.15.1" });
  });
});

describe("unknown routes", () => {
  it("return 404 with the same error shape as other errors", async () => {
    const app = await buildApp({ renderer: fakeRenderer(success) });
    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { kind: "not_found", message: "GET /nope does not exist" } });
  });
});

describe("end to end with real Typst", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({ renderer: createRealRenderer() });
  });

  it("renders a PDF", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/render",
      payload: { template: '#let d = json("data.json")\n= Hello #d.name', data: { name: "Ana" } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("returns diagnostics for a broken template", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/render",
      payload: { template: "#nope", data: {} },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { kind: "compile_failed", diagnostics: [{ message: "unknown variable: nope", line: 1, column: 2 }] },
    });
  });
});

describe("API documentation", () => {
  it("serves an OpenAPI document that covers every route and status code", async () => {
    const app = await buildApp({ renderer: fakeRenderer(success) });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json();

    expect(response.statusCode).toBe(200);
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).toSorted()).toEqual(["/health", "/render"]);
    expect(Object.keys(spec.paths["/render"].post.responses).toSorted()).toEqual([
      "200",
      "400",
      "408",
      "413",
      "415",
      "422",
      "500",
      "503",
    ]);
    expect(spec.paths["/render"].post.responses["200"].content).toHaveProperty("application/pdf");
    expect(spec.components.schemas).toHaveProperty("Diagnostic");
    expect(spec.components.schemas).toHaveProperty("RenderRequest");
  });

  it("serves Swagger UI", async () => {
    const app = await buildApp({ renderer: fakeRenderer(success) });
    const response = await app.inject({ method: "GET", url: "/docs/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("can turn the docs off", async () => {
    const app = await buildApp({ renderer: fakeRenderer(success), docs: false });
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).toBe(404);
  });
});

describe("worker capacity", () => {
  it("returns 503 with Retry-After when the worker is busy", async () => {
    const app = await buildApp({
      renderer: fakeRenderer({ ok: false, error: { kind: "busy", retryAfterSeconds: 1 } }),
    });
    const response = await app.inject({ method: "POST", url: "/render", payload: { template: "x", data: {} } });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
  });
});
