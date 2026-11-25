/** Same alphabet as scripts/demo/fake.js `b64`: standard base64, `+`/`/` swapped, padding kept. */
export function b64urlPad(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

export function threadView(email: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${threadId}`;
}

export function draftView(email: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`;
}

export function snippetOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 120);
}
