import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { FlowSession } from "./imap-flow.js";

interface Recorded {
  method: string;
  range?: string;
  source?: boolean;
  flags?: boolean;
  changedSince?: string;
}

/**
 * A stand-in for ImapFlow. It records every call and the range that call used.
 * FlowSession is the only production code that talks to the real client.
 */
function scripted(caps: string[], deleted: number[] = []) {
  const calls: Recorded[] = [];
  const client = {
    capabilities: new Map(caps.map((name) => [name, true])),
    async getMailboxLock() {
      calls.push({ method: "getMailboxLock" });
      return { release() {} };
    },
    async search() {
      calls.push({ method: "search" });
      return deleted;
    },
    async messageDelete(range: string) {
      calls.push({ method: "messageDelete", range });
      return true;
    },
    async messageCopy(range: string) {
      calls.push({ method: "messageCopy", range });
      return { uidMap: new Map<number, number>() };
    },
    async messageMove(range: string) {
      calls.push({ method: "messageMove", range });
      return { uidMap: new Map<number, number>() };
    },
    async messageFlagsAdd(range: string) {
      calls.push({ method: "messageFlagsAdd", range });
    },
    async messageFlagsRemove(range: string) {
      calls.push({ method: "messageFlagsRemove", range });
    },
    fetch(range: string, query?: { source?: boolean; flags?: boolean }, options?: { changedSince?: bigint }) {
      calls.push({
        method: "fetch",
        range,
        source: query?.source === true,
        flags: query?.flags === true,
        changedSince: options?.changedSince == null ? undefined : String(options.changedSince),
      });
      return (async function* empty() { /* no rows */ })();
    },
  };
  const session = new FlowSession(client as unknown as ImapFlow);
  return { session, calls };
}

function ranges(calls: Recorded[]): string[] {
  return calls.flatMap((call) => (call.range == null ? [] : [call.range]));
}

describe("FlowSession", () => {
  it("expunges only the given UIDs when the server has no UIDPLUS", async () => {
    const clean = scripted([], [4, 9]);
    await expect(clean.session.expunge("INBOX", [4, 9])).resolves.toBe("expunged");
    expect(clean.calls.filter((call) => call.method === "messageDelete")).toEqual([
      { method: "messageDelete", range: "4,9" },
    ]);
    expect(ranges(clean.calls)).not.toContain("1:*");

    const blocked = scripted([], [4, 9, 12]);
    await expect(blocked.session.expunge("INBOX", [4, 9])).resolves.toBe("left-flagged");
    expect(blocked.calls.some((call) => call.method === "messageDelete")).toBe(false);
    expect(ranges(blocked.calls)).not.toContain("1:*");
  });

  it("does not call ImapFlow when a write or a fetch has no UIDs", async () => {
    const { session, calls } = scripted([]);
    await expect(session.copy("INBOX", [], "Archive")).resolves.toEqual(new Map());
    await expect(session.move("INBOX", [], "Archive")).resolves.toEqual(new Map());
    await expect(session.storeFlags("INBOX", [], ["\\Seen"], [])).resolves.toBeUndefined();
    await expect(session.markDeleted("INBOX", [])).resolves.toBeUndefined();
    await expect(session.expunge("INBOX", [])).resolves.toBe("expunged");
    await expect(session.fetch("INBOX", [], { source: true })).resolves.toEqual([]);
    expect(calls).toEqual([]);
    expect(session.writeAttempts).toBe(0);

    const named = scripted(["UIDPLUS", "MOVE"]);
    await named.session.copy("INBOX", [7, 8], "Archive");
    await named.session.move("INBOX", [7], "Archive");
    await named.session.storeFlags("INBOX", [7], ["\\Seen"], ["\\Flagged"]);
    await named.session.expunge("INBOX", [3]);
    await named.session.fetch("INBOX", [2, 5], { flags: true });
    expect(ranges(named.calls)).toEqual(["7,8", "7", "7", "7", "3", "2,5"]);
    expect(ranges(named.calls)).not.toContain("1:*");
  });

  it("reads CHANGEDSINCE across 1:* with flags and without source", async () => {
    const { session, calls } = scripted(["CONDSTORE"]);
    await expect(session.fetchChangedSince("INBOX", "15")).resolves.toEqual([]);
    expect(calls).toEqual([
      { method: "getMailboxLock" },
      { method: "fetch", range: "1:*", source: false, flags: true, changedSince: "15" },
    ]);
    await expect(session.fetch("INBOX", [], { source: true })).resolves.toEqual([]);
    await expect(session.storeFlags("INBOX", [], ["\\Seen"], [])).resolves.toBeUndefined();
    expect(calls.filter((call) => call.range === "1:*")).toHaveLength(1);
    expect(session.writeAttempts).toBe(0);
  });
});
