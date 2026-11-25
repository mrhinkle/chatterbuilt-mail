import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSeal, seal } from "./seal.js";

describe("seal", () => {
  it("round-trips and rejects a tampered payload or the wrong key", () => {
    const key = randomBytes(32);
    const token = "seed-token-DO-NOT-LOG-9f3a7c:gmail_work";
    const sealed = seal(key, token);
    expect(sealed).not.toContain(token);
    expect(sealed).not.toContain("seed-token");
    expect(openSeal(key, sealed)).toBe(token);

    const buf = Buffer.from(sealed, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => openSeal(key, buf.toString("base64"))).toThrow();
    expect(() => openSeal(randomBytes(32), sealed)).toThrow();
  });
});
