import { describe, expect, it } from "vitest";
import { createLoggerOptions, prettyMessage } from "../../../../src/adapter/in/http/logger.js";

describe("createLoggerOptions", () => {
  it("writes JSON lines with no stream for the json format", () => {
    expect(createLoggerOptions({ level: "warn", format: "json" })).toEqual({ level: "warn" });
  });

  it("adds a pretty stream for the pretty format", () => {
    const options = createLoggerOptions({ level: "info", format: "pretty" });

    expect(options.level).toBe("info");
    expect(options.stream).toBeDefined();
  });
});

describe("prettyMessage", () => {
  it("puts the request ID, method, URL, status, and time on one line", () => {
    const log = {
      reqId: "req-3",
      msg: "request completed",
      req: { method: "POST", url: "/render" },
      res: { statusCode: 200 },
      responseTime: 101.4,
    };

    expect(prettyMessage(log, "msg")).toBe("req-3 request completed POST /render → 200 in 101 ms");
  });

  it("keeps only the message when the other fields are missing", () => {
    expect(prettyMessage({ msg: "docspawner is ready" }, "msg")).toBe("docspawner is ready");
  });

  it("ignores fields that are not text or numbers", () => {
    expect(prettyMessage({ reqId: { nested: true }, msg: "hello" }, "msg")).toBe("hello");
  });
});
