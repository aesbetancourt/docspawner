import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when no variable is set", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: "127.0.0.1",
      logLevel: "info",
      typstBinary: "typst",
      fontPaths: [],
      maxConcurrentRenders: availableParallelism(),
      maxQueuedRenders: 100,
    });
  });

  it("reads every variable", () => {
    expect(
      loadConfig({
        PORT: "8080",
        HOST: "0.0.0.0",
        LOG_LEVEL: "warn",
        TYPST_BIN: "/usr/local/bin/typst",
        DOCSPAWNER_FONT_PATHS: "/fonts/a:/fonts/b",
        DOCSPAWNER_MAX_CONCURRENT_RENDERS: "2",
        DOCSPAWNER_MAX_QUEUED_RENDERS: "0",
      }),
    ).toEqual({
      port: 8080,
      host: "0.0.0.0",
      logLevel: "warn",
      typstBinary: "/usr/local/bin/typst",
      fontPaths: ["/fonts/a", "/fonts/b"],
      maxConcurrentRenders: 2,
      maxQueuedRenders: 0,
    });
  });

  it("lists every invalid variable in one error", () => {
    expect(() => loadConfig({ PORT: "abc", LOG_LEVEL: "loud" })).toThrow(/PORT[\s\S]*LOG_LEVEL/);
  });

  it("rejects a port out of range", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
  });
});
