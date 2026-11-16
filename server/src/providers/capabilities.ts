export interface AccountCapabilities {
  filters: boolean;
  sendAs: boolean;
  labels: "labels" | "folders";
}

const TABLE: Record<"gmail" | "imap" | "microsoft", AccountCapabilities> = {
  gmail: { filters: true, sendAs: true, labels: "labels" },
  imap: { filters: false, sendAs: true, labels: "folders" },
  microsoft: { filters: true, sendAs: true, labels: "labels" },
};

/**
 * One row per real kind. A fake mailbox reports the kind it is pretending to be,
 * which is the kind stored on the account.
 */
export function capabilitiesFor(
  kind: "gmail" | "imap" | "microsoft" | "fake",
  pretend?: "gmail" | "imap" | "microsoft",
): AccountCapabilities {
  const key = kind === "fake" ? pretend : kind;
  const row = key ? TABLE[key] : undefined;
  if (!row) return { filters: false, sendAs: false, labels: "folders" };
  return { filters: row.filters, sendAs: row.sendAs, labels: row.labels };
}
