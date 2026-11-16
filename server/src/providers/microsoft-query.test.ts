import { describe, expect, it } from "vitest";
import { attachmentRoute, GRAPH_INLINE_MAX, GRAPH_UPLOAD_CHUNK, GRAPH_UPLOAD_CHUNK_MAX, GRAPH_UPLOAD_MAX, uploadChunkSize } from "./microsoft.js";
import { buildGraphQuery, messageMatches, normalizeLabel } from "./microsoft-query.js";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

describe("microsoft query translation", () => {
  it("treats category operators as having no Graph meaning", () => {
    for (const query of ["category:primary", "in:inbox category:primary", "-category:promotions"]) {
      const built = buildGraphQuery(query, NOW);
      expect(built.empty, query).toBe(true);
      expect(built.droppedCategories, query).toBe(true);
    }
    const mixed = buildGraphQuery("from:alex -category:social", NOW);
    expect(mixed.empty).toBe(false);
    expect(mixed.droppedCategories).toBe(true);
    expect(mixed.search).toContain("from:alex");
    expect(mixed.search).not.toContain("category");
  });

  it("marks from plus unread as both, and keeps a folder filter when there is no search", () => {
    const both = buildGraphQuery("from:alex is:unread", NOW);
    expect(both.both).toBe(true);
    expect(both.search).toBe("from:alex");
    expect(both.filter).toBeNull();
    expect(both.local.unread).toBe(true);

    const dated = buildGraphQuery("(in:inbox) before:2026/11/04", NOW);
    expect(dated.folder).toBe("inbox");
    expect(dated.filter).toContain("receivedDateTime lt 2026-11-04");
    expect(dated.both).toBe(false);

    const recent = buildGraphQuery("in:sent newer_than:3d", NOW);
    expect(recent.folder).toBe("sentitems");
    expect(recent.filter).toContain("receivedDateTime ge ");
    expect(recent.both).toBe(false);
  });

  it("folds an attachment flag into KQL when the rest is already a search", () => {
    const built = buildGraphQuery("from:alex has:attachment", NOW);
    expect(built.search).toContain("from:alex");
    expect(built.search).toContain("hasAttachments:true");
    expect(built.filter).toBeNull();
  });

  it("matches a normalized snooze label without scanning unrelated mail", () => {
    expect(normalizeLabel("CB/Snooze/2026-11-04")).toBe("cb-snooze-2026-11-04");
    const built = buildGraphQuery("label:cb-snooze-2026-11-04", NOW);
    const hit = messageMatches({
      labelIds: ["CB/Snooze/2026-11-04"],
      sender: "a@example.com",
      toRecipients: [],
      subject: "later",
      date: "2026-11-05T00:00:00.000Z",
      attachments: [],
    }, built, NOW, ["CB/Snooze/2026-11-04"]);
    const miss = messageMatches({
      labelIds: ["INBOX"],
      sender: "a@example.com",
      toRecipients: [],
      subject: "now",
      date: "2026-11-05T00:00:00.000Z",
      attachments: [],
    }, built, NOW, ["CB/Snooze/2026-11-04"]);
    expect(hit).toBe(true);
    expect(miss).toBe(false);
  });

  it("routes attachments at the Graph caps without allocating the upload", () => {
    expect(attachmentRoute(0)).toBe("inline");
    expect(attachmentRoute(GRAPH_INLINE_MAX)).toBe("inline");
    expect(attachmentRoute(GRAPH_INLINE_MAX + 1)).toBe("upload");
    expect(attachmentRoute(GRAPH_UPLOAD_MAX)).toBe("upload");
    expect(attachmentRoute(GRAPH_UPLOAD_MAX + 1)).toBe("too_big");
  });

  it("clamps an Outlook upload chunk under 4 MB", () => {
    expect(uploadChunkSize(undefined)).toBe(GRAPH_UPLOAD_CHUNK);
    expect(uploadChunkSize(0)).toBe(GRAPH_UPLOAD_CHUNK);
    expect(uploadChunkSize(Number.NaN)).toBe(GRAPH_UPLOAD_CHUNK);
    expect(uploadChunkSize(-1)).toBe(GRAPH_UPLOAD_CHUNK);
    expect(uploadChunkSize(8)).toBe(8);
    expect(uploadChunkSize(10 * 1024 * 1024)).toBe(GRAPH_UPLOAD_CHUNK_MAX);
    expect(GRAPH_UPLOAD_CHUNK_MAX).toBeLessThan(4 * 1024 * 1024);
  });
});
