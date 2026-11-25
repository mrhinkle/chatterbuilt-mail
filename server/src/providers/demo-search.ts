/**
 * The same special-case ladder as scripts/demo/fake.js `search` (work) and
 * `gmailBridge` (personal). This is not a Gmail query parser. Lane 1b replaces
 * it when GmailProvider exists.
 */
export function demoThreadIds(accountId: string, query: string): string[] {
  const q = query || "";
  if (/personal/.test(accountId)) {
    if (/before:|label:|in:sent/.test(q)) return [];
    return ["p1", "p2", "p3"];
  }
  if (accountId !== "gmail_work") return [];
  if (/before:/.test(q)) return [];
  if (q === "in:sent newer_than:180d") return ["s1", "s2", "s3", "w1"];
  if (/^in:sent to:/.test(q)) return ["s3"];
  if (/^in:sent/.test(q)) return ["w1", "s1"];
  if (/^label:/.test(q)) return [];
  if (/unsubscribe/i.test(q)) return ["t5", "t4", "t7"];
  if (/note to self/i.test(q)) return ["n1"];
  if (/venue|walkthrough/i.test(q)) return ["t2"];
  if (/stripe/i.test(q)) return ["t4", "t7"];
  if (/dana@|acmerobotics/i.test(q)) return ["s3", "t1"];
  return ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
}
