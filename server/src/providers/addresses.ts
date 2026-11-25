export function addressList(value: unknown): string[] {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

export function emailOf(value: string): string {
  const wrapped = /<([^>]+)>/.exec(value);
  return (wrapped?.[1] ?? value).trim().toLowerCase();
}

/** A reply goes to Reply-To or the sender. A message this account sent goes to that message's To, and reply-all also keeps its Cc. Own addresses are dropped. A passed Cc replaces the default Cc. */
export function replyAudience(input: {
  replyAll: boolean;
  sender: string;
  replyTo: string[];
  to: string[];
  cc: string[];
  passedCc: string[];
  own: Set<string>;
}): { to: string[]; cc: string[] } {
  const sentByUs = input.own.has(emailOf(input.sender));
  const primary = sentByUs ? input.to : (input.replyTo.length > 0 ? input.replyTo : [input.sender]);
  const extras = sentByUs || !input.replyAll ? [] : input.to;
  const to = dedupeAddresses([...primary, ...extras], input.own);
  const ccSource = input.passedCc.length > 0 || !input.replyAll ? input.passedCc : input.cc;
  const cc = dedupeAddresses(ccSource, input.own).filter((value) => !to.some((item) => emailOf(item) === emailOf(value)));
  return { to, cc };
}

export function dedupeAddresses(values: string[], own: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = emailOf(value);
    if (!email || own.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(value);
  }
  return out;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function textToHtml(text: string): string {
  return `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

export function reSubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:/i.test(trimmed)) return trimmed;
  return trimmed ? `Re: ${trimmed}` : "Re:";
}

export function fwdSubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^fwd:/i.test(trimmed)) return trimmed;
  return trimmed ? `Fwd: ${trimmed}` : "Fwd:";
}
