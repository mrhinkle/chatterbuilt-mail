/** Message-id and reply headers derived from the thread's last message. */
export function messageIdFor(messageId: string): string {
  const bare = messageId.trim().replace(/^<|>$/g, "");
  if (bare.includes("@")) return `<${bare}>`;
  return `<${bare}@mail.example>`;
}

export function replyHeaders(last: { id: string; references: string }): { inReplyTo: string; references: string } {
  const own = messageIdFor(last.id);
  const prior = last.references.trim();
  if (!prior) return { inReplyTo: own, references: own };
  if (prior.includes(own)) return { inReplyTo: own, references: prior };
  return { inReplyTo: own, references: `${prior} ${own}` };
}
