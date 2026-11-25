import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassphrase, verifyPassphrase } from "./passphrase.js";

const STORED = /^scrypt\$17\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
const PHRASE = "correct-horse-battery";

describe("passphrase", () => {
  it("stores two claims of the same passphrase as different scrypt rows", async () => {
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
    };
    const first = await hashPassphrase(PHRASE);
    const second = await hashPassphrase(PHRASE);
    expect(first).toMatch(STORED);
    expect(second).toMatch(STORED);
    expect(first).not.toBe(second);
    expect(await verifyPassphrase(PHRASE, first, warn)).toBe(true);
    expect(await verifyPassphrase("wrong-horse-battery", first, warn)).toBe(false);
    expect(await verifyPassphrase(`${PHRASE}x`, first, warn)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("verifies with the parameters stored on the row", async () => {
    const warnings: string[] = [];
    const row = await hashPassphrase(PHRASE, { logN: 14 });
    expect(row.startsWith("scrypt$14$8$1$")).toBe(true);
    expect(row).not.toMatch(STORED);
    expect(await verifyPassphrase(PHRASE, row, (message) => warnings.push(message))).toBe(true);
    const weakened = row.replace("$14$", "$17$");
    expect(await verifyPassphrase(PHRASE, weakened, (message) => warnings.push(message))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("fails closed on a legacy sha256 row and on a malformed string, without logging the value", async () => {
    const legacy = createHash("sha256").update(PHRASE).digest("hex");
    const malformed = "not-a-scrypt-row";
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
    };
    expect(legacy).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPassphrase(PHRASE, legacy, warn)).toBe(false);
    expect(await verifyPassphrase(PHRASE, malformed, warn)).toBe(false);
    expect(await verifyPassphrase(PHRASE, "scrypt$13$8$1$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", warn)).toBe(false);
    expect(await verifyPassphrase(PHRASE, "scrypt$17$8$1$short$short", warn)).toBe(false);
    expect(warnings).toEqual([
      "sign-in passphrase hash is not usable",
      "sign-in passphrase hash is not usable",
      "sign-in passphrase hash is not usable",
      "sign-in passphrase hash is not usable",
    ]);
    const logged = warnings.join("\n");
    expect(logged).not.toContain(legacy);
    expect(logged).not.toContain(malformed);
    expect(logged).not.toContain(PHRASE);
  });
});
