import { describe, expect, it } from "vitest";
import { rememberStart } from "./start-once.js";

describe("mcp start", () => {
  it("clears a rejected start and keeps a successful one", async () => {
    let calls = 0;
    const start = rememberStart(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boot failed");
      return "ready";
    });
    await expect(start()).rejects.toThrow(/boot failed/);
    await expect(start()).resolves.toBe("ready");
    await expect(start()).resolves.toBe("ready");
    expect(calls).toBe(2);
  });
});
