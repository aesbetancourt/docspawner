import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../../src/domain/render.js";
import { validateRequest } from "../../../src/application/service/validate-request.js";

const limits = { ...DEFAULT_LIMITS, maxTemplateBytes: 20, maxDataBytes: 20 };

describe("validateRequest", () => {
  it("accepts a valid request and encodes data as JSON", () => {
    const result = validateRequest({ template: "= Hi", data: { a: 1 } }, limits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new TextDecoder().decode(result.value.dataJson)).toBe('{"a":1}');
    expect(result.value.timeoutMs).toBe(DEFAULT_LIMITS.defaultTimeoutMs);
    expect(result.value.timestamp).toBeUndefined();
  });

  it("rejects an empty template", () => {
    expect(validateRequest({ template: "  ", data: {} }, limits)).toMatchObject({
      ok: false,
      error: { kind: "invalid_input" },
    });
  });

  it("rejects data that is not a JSON value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(validateRequest({ template: "x", data: undefined }, limits)).toMatchObject({ ok: false });
    expect(validateRequest({ template: "x", data: circular }, limits)).toMatchObject({ ok: false });
  });

  it("rejects a template or data above the size limit", () => {
    expect(validateRequest({ template: "x".repeat(21), data: {} }, limits)).toEqual({
      ok: false,
      error: { kind: "input_too_large", field: "template", limitBytes: 20 },
    });
    expect(validateRequest({ template: "x", data: "y".repeat(30) }, limits)).toEqual({
      ok: false,
      error: { kind: "input_too_large", field: "data", limitBytes: 20 },
    });
  });

  it("rejects a timeout outside the allowed range", () => {
    for (const timeoutMs of [0, -1, 1.5, DEFAULT_LIMITS.maxTimeoutMs + 1]) {
      expect(validateRequest({ template: "x", data: {}, options: { timeoutMs } }, limits).ok).toBe(false);
    }
  });

  it("rejects a negative or fractional timestamp", () => {
    for (const timestamp of [-1, 1.5]) {
      expect(validateRequest({ template: "x", data: {}, options: { timestamp } }, limits).ok).toBe(false);
    }
  });

  it("names the field path in the error message", () => {
    const result = validateRequest({ template: "x", data: {}, options: { timeoutMs: 0 } }, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "invalid_input",
      message: expect.stringContaining("options.timeoutMs"),
    });
  });

  it("reports every problem in one message", () => {
    const result = validateRequest({ template: "", data: undefined }, limits);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "invalid_input") return;
    expect(result.error.message).toContain("template must not be empty");
    expect(result.error.message).toContain("data must be a JSON value");
  });

  it("reports a size limit before other problems", () => {
    const result = validateRequest({ template: "x".repeat(21), data: {}, options: { timeoutMs: 0 } }, limits);
    expect(result).toEqual({ ok: false, error: { kind: "input_too_large", field: "template", limitBytes: 20 } });
  });

  it("uses the default timeout when none is sent", () => {
    const result = validateRequest({ template: "x", data: null }, limits);
    expect(result).toMatchObject({ ok: true, value: { timeoutMs: DEFAULT_LIMITS.defaultTimeoutMs } });
  });
});
