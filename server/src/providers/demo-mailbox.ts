import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlPad, draftView, snippetOf, threadView } from "./codec.js";
import type {
  AccountRecord,
  Attachment,
  DraftRecord,
  LabelRecord,
  MailMessage,
  MailThread,
  SendAsRecord,
} from "./types.js";

export const DEMO_NOW_MS = Date.parse("2026-11-04T15:00:00.000Z");
export const DEMO_NOW = "2026-11-04T15:00:00.000Z";
const H = 36e5;
const D = 864e5;

const WORK_EMAIL = "alex@riveralabs.example";
const PERSONAL_EMAIL = "alex.rivera@mail.example";
const ME = "Alex Rivera <alex@riveralabs.example>";
const ME2 = "Alex Rivera <alex.rivera@mail.example>";

export const WORK_ACCOUNT: AccountRecord = {
  id: "gmail_work",
  email: WORK_EMAIL,
  label: "Rivera Labs",
  kind: "gmail",
  color: "blue",
};
export const PERSONAL_ACCOUNT: AccountRecord = {
  id: "gmail_personal",
  email: PERSONAL_EMAIL,
  label: "Personal",
  kind: "gmail",
  color: "red",
};

const SYSTEM_LABELS: LabelRecord[] = [
  { labelId: "INBOX", name: "INBOX", labelType: "SYSTEM" },
  { labelId: "SENT", name: "SENT", labelType: "SYSTEM" },
  { labelId: "UNREAD", name: "UNREAD", labelType: "SYSTEM" },
  { labelId: "STARRED", name: "STARRED", labelType: "SYSTEM" },
  { labelId: "DRAFT", name: "DRAFT", labelType: "SYSTEM" },
];

interface SeedMessage {
  id: string;
  sender: string;
  toRecipients: string[];
  ccRecipients?: string[];
  subject: string;
  ago: number;
  labelIds: string[];
  plaintextBody: string;
  htmlBody?: string;
  attachments?: { filename: string; mimeType: string }[];
  rawText?: string;
}

interface SeedThread {
  id: string;
  messages: SeedMessage[];
}

function iso(ago: number): string {
  return new Date(DEMO_NOW_MS - ago).toISOString();
}

function loadConst(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../scripts/demo/fake.js"),
    join(here, "../../../../scripts/demo/fake.js"),
    join(process.cwd(), "../scripts/demo/fake.js"),
    join(process.cwd(), "scripts/demo/fake.js"),
  ];
  let source = "";
  for (const path of candidates) {
    if (existsSync(path)) {
      source = readFileSync(path, "utf8");
      break;
    }
  }
  if (!source) throw new Error("scripts/demo/fake.js is missing; FakeProvider cannot start");
  const match = new RegExp(`const ${name} = '([^']+)';`).exec(source);
  if (!match) throw new Error(`scripts/demo/fake.js is missing ${name}`);
  return match[1];
}

function attachments(list: { filename: string; mimeType: string }[] | undefined): Attachment[] {
  return (list ?? []).map((item, index) => ({
    id: `att${index}`,
    filename: item.filename,
    mimeType: item.mimeType,
    cid: "",
  }));
}

function genericRaw(message: SeedMessage, date: string): string {
  const headers = [
    `From: ${message.sender}`,
    `To: ${message.toRecipients.join(", ")}`,
    ...(message.ccRecipients?.length ? [`Cc: ${message.ccRecipients.join(", ")}`] : []),
    `Subject: ${message.subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  return b64urlPad(`${headers.join("\r\n")}\r\n\r\n${message.plaintextBody}`);
}

function cloudwayRaw(invoicePdf: string): string {
  const wrapped = invoicePdf.replace(/(.{76})/g, "$1\r\n");
  const text = [
    "From: Cloudway Billing <billing@notify.cloudway.example>",
    "To: Alex Rivera <alex@riveralabs.example>",
    "Subject: Payment received for invoice CW-2026-1142",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="cwb"',
    "",
    "--cwb",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Thanks for your payment.",
    "--cwb",
    'Content-Type: application/pdf; name="CW-2026-1142.pdf"',
    'Content-Disposition: attachment; filename="CW-2026-1142.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapped,
    "--cwb--",
    "",
  ].join("\r\n");
  return b64urlPad(text);
}

function weeklyRaw(): string {
  return b64urlPad(
    "List-Unsubscribe: <https://weeklybyte.example/u?x=demo>, <mailto:leave@weeklybyte.example?subject=unsubscribe>\r\nSubject: This week in AI\r\n\r\nbody",
  );
}

let cached: Mailbox | undefined;

export interface Mailbox {
  accounts: AccountRecord[];
  threads: Map<string, MailThread[]>;
  labels: Map<string, LabelRecord[]>;
  drafts: Map<string, DraftRecord[]>;
  sendAs: Map<string, SendAsRecord[]>;
  signature: string;
  invoicePdf: string;
}

function buildThread(seed: SeedThread, email: string, specialRaw: (id: string) => string | undefined): MailThread {
  const messages: MailMessage[] = seed.messages.map((message, position) => {
    const date = iso(message.ago);
    const raw = specialRaw(message.id) ?? genericRaw(message, date);
    return {
      id: message.id,
      threadId: seed.id,
      position,
      sender: message.sender,
      toRecipients: message.toRecipients,
      ccRecipients: message.ccRecipients ?? [],
      bccRecipients: [],
      replyTo: [],
      inReplyTo: "",
      references: "",
      subject: message.subject,
      date,
      labelIds: message.labelIds,
      snippet: snippetOf(message.plaintextBody),
      plaintextBody: message.plaintextBody,
      htmlBody: message.htmlBody ?? null,
      attachments: attachments(message.attachments),
      raw,
      viewUrl: threadView(email, seed.id),
      bodyFetched: true,
    };
  });
  const newest = messages[messages.length - 1];
  return {
    id: seed.id,
    snippet: newest?.snippet ?? "",
    messageCount: messages.length,
    viewUrl: threadView(email, seed.id),
    historyId: null,
    messages,
  };
}

function workSeeds(signature: string): SeedThread[] {
  const inbox = (
    id: string,
    from: string,
    subject: string,
    body: string,
    ago: number,
    extra?: Partial<SeedMessage>,
  ): SeedThread => ({
    id,
    messages: [
      {
        id: `m${id}`,
        sender: from,
        toRecipients: [ME],
        subject,
        ago,
        labelIds: ["INBOX", "UNREAD"],
        plaintextBody: body,
        ...extra,
      },
    ],
  });
  const sent = (
    id: string,
    to: string,
    subject: string,
    body: string,
    ago: number,
    before: SeedMessage[] = [],
  ): SeedThread => ({
    id,
    messages: [
      ...before,
      {
        id: `m${id}`,
        sender: ME,
        toRecipients: [to],
        subject,
        ago,
        labelIds: ["SENT"],
        plaintextBody: body,
      },
    ],
  });

  const t5html =
    '<div style="font-family:Georgia,serif;max-width:560px"><h1 style="font-size:22px">The Weekly Byte</h1><p>Five stories you missed this week.</p><h2 style="font-size:17px">1. Agents that file their own tickets</h2><p>Support teams are letting agents open, tag and route tickets. <a href="https://weeklybyte.example/agents">Read more</a></p><h2 style="font-size:17px">2. The quiet return of on-prem</h2><p>Why some teams are bringing models back in-house.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Story</th><th>Minutes</th></tr><tr><td>Agents</td><td>4</td></tr><tr><td>On-prem</td><td>6</td></tr></table><img src="https://track.weeklybyte.example/open.gif" width="1" height="1"><p style="font-size:12px"><a href="https://weeklybyte.example/unsubscribe?u=demo">Unsubscribe</a></p><script>alert(1)</script></div>';

  return [
    inbox(
      "t1",
      "Dana Ruiz <dana@acmerobotics.example>",
      "Sponsorship for the spring summit",
      "Hi Alex,\n\nCan we lock the gold package by Friday? What date works for a call next week?\n\nDana Ruiz\nVP Marketing, Acme Robotics\n+1 919 555 0142\nhttps://www.linkedin.com/in/danaruiz-example/\nhttps://x.com/danaruiz_example",
      2 * H,
    ),
    inbox(
      "t2",
      "Lee Park <lee@venuehall.example>",
      "Venue walkthrough",
      "Hi Alex, want to walk the space before we sign? Tuesday or Wednesday morning works on our side.",
      5 * H,
    ),
    inbox(
      "t3",
      "Priya Shah <priya@northwind.example>",
      "Podcast guest spot in December",
      "Would you join us on the Northwind podcast? 30 minutes, recorded remotely.",
      9 * H,
    ),
    inbox("t4", "Stripe <receipts@stripe.example>", "Your receipt from Rivera Labs", "Receipt for $49.00", 11 * H, {
      labelIds: ["INBOX"],
    }),
    inbox(
      "t5",
      "The Weekly Byte <news@weeklybyte.example>",
      "This week in AI: agents at work",
      "Five stories you missed this week.\n\n1. Agents that file their own tickets\n2. The quiet return of on-prem\n\nUnsubscribe: https://weeklybyte.example/unsubscribe?u=demo",
      14 * H,
      { labelIds: ["INBOX"], htmlBody: t5html },
    ),
    inbox(
      "t6",
      "Morgan Lee <morgan@cityworks.example>",
      "Intro: Alex, meet Jordan",
      "Alex, meet Jordan, who runs the downtown makerspace. I think you two should talk.",
      26 * H,
      { ccRecipients: ["Jordan Blake <jordan@makerspace.example>"] },
    ),
    inbox("t7", "Stripe <receipts@stripe.example>", "Your receipt from Rivera Labs", "Receipt for $120.00", 30 * H, {
      labelIds: ["INBOX"],
    }),
    inbox(
      "t8",
      "Cloudway Billing <billing@notify.cloudway.example>",
      "Payment received for invoice CW-2026-1142",
      "Thanks for your payment. Invoice CW-2026-1142 for Rivera Labs has been paid. The invoice PDF is attached. This mailbox is not monitored.",
      32 * H,
      {
        labelIds: ["INBOX"],
        attachments: [{ filename: "CW-2026-1142.pdf", mimeType: "application/pdf" }],
      },
    ),
    sent(
      "w1",
      "Jordan Blake <jordan@makerspace.example>",
      "Re: Space for the March meetup",
      "Hi Jordan, could the March meetup use the big room? We expect about 60 people. Happy to cover cleanup. Alex",
      5 * D,
      [
        {
          id: "mw1a",
          sender: "Jordan Blake <jordan@makerspace.example>",
          toRecipients: [ME],
          subject: "Space for the March meetup",
          ago: 7 * D,
          labelIds: [],
          plaintextBody: "Morgan said you might need a room for your meetup. Happy to talk.",
        },
      ],
    ),
    sent(
      "s1",
      "Sam Ortiz <sam@riveralabs.example>",
      "Re: Panel",
      "Sam, happy to do the panel. Send the run of show and I will block the time. Alex",
      20 * D,
    ),
    sent(
      "s2",
      "Pat Kim <pat@example.org>",
      "Re: Intro",
      "Thanks for the intro, Pat. Moving you to bcc. Jo, great to meet you. Does Thursday work? Alex",
      30 * D,
    ),
    sent("n1", ME, "Note to self: meetup venues", "Ask Jordan about the big room. Check the library annex too.", 3 * H),
    sent(
      "s3",
      "Dana Ruiz <dana@acmerobotics.example>",
      "Re: Fall meetup",
      "Dana, good to meet you at the meetup. Short version: yes, let us talk sponsorship in the new year. Alex",
      40 * D,
    ),
  ].map((thread) => {
    if (thread.id !== "s1") return thread;
    const last = thread.messages[thread.messages.length - 1];
    last.htmlBody =
      '<div dir="ltr">Sam, happy to do the panel. Send the run of show and I will block the time.<br><br>Alex<br><br><div class="gmail_signature" data-smartmail="gmail_signature">' +
      signature +
      "</div></div>";
    return thread;
  });
}

function personalSeeds(): SeedThread[] {
  const row = (id: string, from: string, subject: string, body: string, ago: number, labelIds: string[]): SeedThread => ({
    id,
    messages: [
      {
        id: `m${id}`,
        sender: from,
        toRecipients: [ME2],
        subject,
        ago,
        labelIds,
        plaintextBody: body,
      },
    ],
  });
  return [
    row("p1", "Casey Rivera <casey@family.example>", "Saturday dinner", "Still on for Saturday? We can do 6:30 if that works better for you.", 3 * H, ["INBOX", "UNREAD"]),
    row("p2", "Library Annex <events@libraryannex.example>", "Your room booking is confirmed", "Room B is booked for March 14, 6 to 9 pm. Reply to this email to change it.", 20 * H, ["INBOX"]),
    row("p3", "Spokeworks <service@spokeworks.example>", "Your tune-up is ready", "Your bike is ready for pickup any time before 6.", 2 * D, ["INBOX"]),
  ];
}

function userLabels(names: string[]): LabelRecord[] {
  return names.map((name, index) => ({ labelId: `L${index + 1}`, name, labelType: "USER" as const }));
}

function draftRaw(draft: {
  toRecipients: string[];
  ccRecipients: string[];
  subject: string;
  date: string;
  plaintextBody: string;
}): string {
  const headers = [
    `From: ${ME}`,
    `To: ${draft.toRecipients.join(", ")}`,
    ...(draft.ccRecipients.length ? [`Cc: ${draft.ccRecipients.join(", ")}`] : []),
    `Subject: ${draft.subject}`,
    `Date: ${draft.date}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  return b64urlPad(`${headers.join("\r\n")}\r\n\r\n${draft.plaintextBody}`);
}

function workDrafts(): DraftRecord[] {
  const view = draftView(WORK_EMAIL);
  const seeds = [
    {
      id: "d1",
      messageId: "md1",
      threadId: "t2",
      subject: "Re: Venue walkthrough",
      toRecipients: ["Lee Park <lee@venuehall.example>"],
      ccRecipients: [] as string[],
      bccRecipients: [] as string[],
      date: iso(H),
      snippet: "Hi Lee, Tuesday at 10 works. See you there. Alex",
      plaintextBody: "Hi Lee,\n\nTuesday at 10 works. See you there.\n\nAlex",
      htmlBody: '<div dir="ltr">Hi Lee,<br><br>Tuesday at 10 works. See you there.<br><br>Alex</div>',
    },
    {
      id: "d2",
      messageId: "md2",
      threadId: "",
      subject: "Keynote at the spring summit?",
      toRecipients: ["Riley Chen <riley@keynote.example>"],
      ccRecipients: [] as string[],
      bccRecipients: [] as string[],
      date: iso(2 * H),
      snippet: "Riley, your talk on AI agents at the March meetup was the one people kept quoting",
      plaintextBody:
        "Riley,\n\nYour talk on AI agents at the March meetup was the one people kept quoting. Would you keynote the spring summit in April?\n\nAlex",
      htmlBody:
        "<p>Riley,</p><p>Your talk on AI agents at the March meetup was the one people kept quoting. Would you keynote the spring summit in <b>April</b>?</p><p>Alex</p>",
    },
    {
      id: "d3",
      messageId: "md3",
      threadId: "s2",
      subject: "Re: Intro",
      toRecipients: ["Jo Park <jo@example.org>"],
      ccRecipients: ["Pat Kim <pat@example.org>"],
      bccRecipients: [] as string[],
      date: iso(3 * H),
      snippet: "Jo, following up on Thursday. Does 2pm still work?",
      plaintextBody: "Jo,\n\nFollowing up on Thursday. Does 2pm still work?\n\nAlex",
      htmlBody: null as string | null,
    },
  ];
  return seeds.map((seed) => ({
    ...seed,
    inReplyTo: "",
    references: "",
    attachments: [],
    labelIds: ["DRAFT"],
    viewUrl: view,
    bodyFetched: true,
    raw: draftRaw({ ...seed, plaintextBody: seed.plaintextBody }),
  }));
}

export function demoMailbox(): Mailbox {
  if (cached) return cached;
  const signature = loadConst("SIG");
  const invoicePdf = loadConst("INVOICE_PDF");
  if (!signature.includes("Alex Rivera")) throw new Error("fake.js SIG did not parse");
  if (!invoicePdf.startsWith("JVBERi0")) throw new Error("fake.js INVOICE_PDF did not parse");
  const special = (id: string): string | undefined => {
    if (id === "mt5") return weeklyRaw();
    if (id === "mt8") return cloudwayRaw(invoicePdf);
    return undefined;
  };
  const work = workSeeds(signature).map((seed) => buildThread(seed, WORK_EMAIL, special));
  const personal = personalSeeds().map((seed) => buildThread(seed, PERSONAL_EMAIL, () => undefined));
  cached = {
    accounts: [WORK_ACCOUNT, PERSONAL_ACCOUNT],
    threads: new Map([
      [WORK_ACCOUNT.id, work],
      [PERSONAL_ACCOUNT.id, personal],
    ]),
    labels: new Map([
      [WORK_ACCOUNT.id, [...SYSTEM_LABELS, ...userLabels(["Finance", "Sponsors", "Meetup", "Newsletters"])]],
      [PERSONAL_ACCOUNT.id, [...SYSTEM_LABELS, ...userLabels(["Family", "Bikes"])]],
    ]),
    drafts: new Map([
      [WORK_ACCOUNT.id, workDrafts()],
      [PERSONAL_ACCOUNT.id, []],
    ]),
    sendAs: new Map([
      [
        WORK_ACCOUNT.id,
        [
          { email: WORK_EMAIL, signature, isDefault: true, isPrimary: true, verified: true },
          { email: "events@riveralabs.example", signature: "", isDefault: false, isPrimary: false, verified: true },
        ],
      ],
      [
        PERSONAL_ACCOUNT.id,
        [{ email: PERSONAL_EMAIL, signature: "", isDefault: true, isPrimary: true, verified: true }],
      ],
    ]),
    signature,
    invoicePdf,
  };
  return cached;
}

export function seedToken(accountId: string): string {
  return `seed-token-DO-NOT-LOG-9f3a7c:${accountId}`;
}
