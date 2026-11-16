import { afterEach, describe, expect, it } from "vitest";
import { refuseUnavailable } from "./router.js";
import type { MailProvider } from "./types.js";

describe("provider stubs", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("does not refuse IMAP or Microsoft and does not call fetch", () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      throw new Error("network");
    }) as typeof fetch;
    const imap = { kind: "imap" } as MailProvider;
    const microsoft = { kind: "microsoft" } as MailProvider;
    expect(() => refuseUnavailable(imap, { kind: "imap" })).not.toThrow();
    expect(() => refuseUnavailable(microsoft, { kind: "microsoft" })).not.toThrow();
    expect(called).toBe(0);
  });
});
