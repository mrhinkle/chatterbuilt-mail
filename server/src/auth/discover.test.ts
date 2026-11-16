import { describe, expect, it } from "vitest";
import {
  DISCOVER_MISS,
  GOOGLE_CARD,
  MICROSOFT_CARD,
  PROTON_STOP,
  discover,
  type DiscoverDeps,
  type DiscoverResponse,
} from "./discover.js";

const PUBLIC = "203.0.113.20";

function xml(imapHost: string, smtpHost = "smtp.example.com"): string {
  return `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <incomingServer type="imap">
      <hostname>${imapHost}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${smtpHost}</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;
}

function harness(options: {
  page?: (url: string) => DiscoverResponse | null;
  resolve?: (host: string) => string[];
  mx?: string[];
  probe?: (host: string, port: number) => boolean;
} = {}): { deps: DiscoverDeps; urls: string[]; probes: string[] } {
  const urls: string[] = [];
  const probes: string[] = [];
  const deps: DiscoverDeps = {
    timeoutMs: 500,
    allowPrivate: false,
    resolve: async (host) => options.resolve?.(host) ?? [PUBLIC],
    fetch: async (input) => {
      urls.push(input.url);
      return options.page?.(input.url) ?? { status: 404, body: "", location: null };
    },
    probe: async (input) => {
      probes.push(`${input.host}:${input.port}`);
      return options.probe?.(input.host, input.port) ?? false;
    },
    mx: async () => options.mx ?? [],
  };
  return { deps, urls, probes };
}

describe("discover", () => {
  it("uses the iCloud and Yahoo presets and does not fetch", async () => {
    const { deps, urls } = harness({ page: () => { throw new Error("fetch"); } });
    const icloud = await discover("Ada@icloud.com", deps);
    const me = await discover("ada@me.com", deps);
    const yahoo = await discover("ada@yahoo.co.uk", deps);
    expect(urls).toEqual([]);
    expect(icloud).toMatchObject({
      kind: "settings",
      settings: {
        provider: "icloud",
        imapHost: "imap.mail.me.com",
        imapPort: 993,
        imapSecurity: "tls",
        smtpHost: "smtp.mail.me.com",
        smtpPort: 587,
        smtpSecurity: "starttls",
        serverKeepsSent: true,
        helpUrl: "https://support.apple.com/en-us/102654",
        source: "preset",
      },
    });
    expect(me).toMatchObject({ kind: "settings", settings: { provider: "icloud", source: "preset" } });
    expect(yahoo).toMatchObject({
      kind: "settings",
      settings: {
        provider: "yahoo",
        imapHost: "imap.mail.yahoo.com",
        smtpHost: "smtp.mail.yahoo.com",
        smtpPort: 465,
        helpUrl: "https://help.yahoo.com/kb/learn-generate-third-party-passwords-sln15241.html",
      },
    });
  });

  it("reads Fastmail from the MX host and does not send the address to the ISPDB", async () => {
    const { deps, urls, probes } = harness({ mx: ["in1-smtp.messagingengine.com"] });
    const found = await discover("ada@custom.example", deps);
    expect(found).toMatchObject({
      kind: "settings",
      settings: { provider: "fastmail", imapHost: "imap.fastmail.com", source: "mx" },
    });
    expect(probes).toEqual([]);
    expect(urls.some((url) => url.startsWith("http:"))).toBe(false);
    expect(urls.some((url) => url.includes("thunderbird.net") && url.includes("ada"))).toBe(false);
    expect(urls.filter((url) => url.includes("ada")).every((url) => url.startsWith("https://autoconfig.custom.example/"))).toBe(true);
  });

  it("sends a Google or Microsoft MX to that card and does not probe IMAP", async () => {
    const google = harness({ mx: ["aspmx.l.google.com"] });
    const microsoft = harness({ mx: ["contoso.mail.protection.outlook.com"] });
    expect(await discover("ada@custom.example", google.deps)).toEqual({ kind: "card", provider: "google", message: GOOGLE_CARD });
    expect(await discover("ada@custom.example", microsoft.deps)).toEqual({ kind: "card", provider: "microsoft", message: MICROSOFT_CARD });
    expect(google.probes).toEqual([]);
    expect(microsoft.probes).toEqual([]);
    const notGoogle = harness({ mx: ["mx.notgoogle.com"] });
    expect((await discover("ada@custom.example", notGoogle.deps)).kind).not.toBe("card");
  });

  it("stops on Proton and does not return an IMAP host", async () => {
    const { deps, urls, probes } = harness({ page: () => { throw new Error("fetch"); } });
    const found = await discover("ada@proton.me", deps);
    expect(found).toMatchObject({
      kind: "stop",
      message: PROTON_STOP,
      helpUrl: "https://proton.me/support/imap-smtp-and-pop3-setup",
    });
    expect(urls).toEqual([]);
    expect(probes).toEqual([]);
    expect(JSON.stringify(found)).not.toContain("imap.");
  });

  it("tries autoconfig, then the well-known URL, then the ISPDB domain only", async () => {
    const { deps, urls } = harness({
      page: (url) => url === "https://autoconfig.thunderbird.net/v1.1/example.com"
        ? { status: 200, body: xml("imap.ispdb.example"), location: null }
        : null,
    });
    const found = await discover("ada@example.com", deps);
    expect(urls[0]).toBe("https://autoconfig.example.com/mail/config-v1.1.xml?emailaddress=ada%40example.com");
    expect(urls[1]).toBe("https://example.com/.well-known/autoconfig/mail/config-v1.1.xml");
    expect(urls[1]).not.toContain("ada");
    expect(urls[2]).toBe("https://autoconfig.thunderbird.net/v1.1/example.com");
    expect(urls[2]).not.toContain("ada");
    expect(urls.every((url) => url.startsWith("https:"))).toBe(true);
    expect(found).toMatchObject({
      kind: "settings",
      settings: { imapHost: "imap.ispdb.example", source: "ispdb", serverKeepsSent: false, helpUrl: null },
    });
  });

  it("does not fetch an http redirect", async () => {
    const { deps, urls } = harness({
      page: (url) => url.startsWith("https://autoconfig.example.com/")
        ? { status: 302, body: "", location: "http://evil.example/mail/config-v1.1.xml" }
        : null,
    });
    await discover("ada@example.com", deps);
    expect(urls.some((url) => url.startsWith("http:"))).toBe(false);
    expect(urls.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("does not fetch a redirect that resolves to a private or metadata address", async () => {
    for (const blocked of ["10.1.1.1", "169.254.169.254"]) {
      const { deps, urls } = harness({
        resolve: (host) => host === "evil.example" ? [blocked] : [PUBLIC],
        page: (url) => url.startsWith("https://autoconfig.example.com/")
          ? { status: 302, body: "", location: "https://evil.example/mail/config-v1.1.xml?emailaddress=ada%40example.com" }
          : null,
      });
      await discover("ada@example.com", deps);
      expect(urls.some((url) => url.includes("evil.example"))).toBe(false);
    }
  });

  it("drops the address when a redirect changes host", async () => {
    const { deps, urls } = harness({
      page: (url) => {
        if (url.startsWith("https://autoconfig.example.com/")) {
          return { status: 302, body: "", location: "https://configs.example.net/mail/config-v1.1.xml?emailaddress=ada%40example.com" };
        }
        if (url.startsWith("https://configs.example.net/")) return { status: 200, body: xml("imap.redirect.example"), location: null };
        return null;
      },
    });
    const found = await discover("ada@example.com", deps);
    expect(urls[1]).toBe("https://configs.example.net/mail/config-v1.1.xml");
    expect(urls[1]).not.toContain("ada");
    expect(found).toMatchObject({ kind: "settings", settings: { imapHost: "imap.redirect.example" } });
  });

  it("ignores an oversize body and a document with a doctype or an entity", async () => {
    const huge = `${xml("imap.hidden.example")}${"a".repeat(70_000)}`;
    const hostile = `<!DOCTYPE foo [<!ENTITY x SYSTEM "http://evil.example/x">]>
<clientConfig>
  <incomingServer type="imap"><hostname>imap.stolen.example</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.stolen.example</hostname><port>465</port><socketType>SSL</socketType></outgoingServer>
</clientConfig>`;
    const oversize = harness({ page: () => ({ status: 200, body: huge, location: null }) });
    const entity = harness({ page: () => ({ status: 200, body: hostile, location: null }) });
    const left = await discover("ada@example.com", oversize.deps);
    const right = await discover("ada@example.com", entity.deps);
    expect(JSON.stringify(left)).not.toContain("imap.hidden.example");
    expect(JSON.stringify(right)).not.toContain("imap.stolen.example");
    expect(entity.urls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(left).toMatchObject({ kind: "miss", message: DISCOVER_MISS });
  });

  it("shows a guessed server only after the handshake, and skips a private address", async () => {
    const yes = harness({
      probe: (host, port) => (host === "imap.example.com" && port === 993) || (host === "smtp.example.com" && port === 465),
    });
    const found = await discover("ada@example.com", yes.deps);
    expect(found).toMatchObject({
      kind: "settings",
      settings: {
        imapHost: "imap.example.com",
        imapPort: 993,
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpSecurity: "tls",
        source: "guess",
        serverKeepsSent: false,
      },
    });
    expect(yes.probes).toContain("imap.example.com:993");
    expect(yes.probes).toContain("smtp.example.com:465");

    const no = harness({ resolve: () => ["10.1.1.1"], probe: () => { throw new Error("probed"); } });
    const missed = await discover("ada@example.com", no.deps);
    expect(missed).toEqual({ kind: "miss", message: DISCOVER_MISS });
    expect(no.probes).toEqual([]);
  });

  it("asks the ISPDB for the registrable domain of the MX host", async () => {
    const { deps, urls } = harness({
      mx: ["mx.mail.example.co.uk"],
      page: (url) => url === "https://autoconfig.thunderbird.net/v1.1/example.co.uk"
        ? { status: 200, body: xml("imap.example.co.uk"), location: null }
        : null,
    });
    const found = await discover("ada@custom.example", deps);
    expect(urls).toContain("https://autoconfig.thunderbird.net/v1.1/example.co.uk");
    expect(urls.some((url) => url.includes("/v1.1/co.uk"))).toBe(false);
    expect(urls.some((url) => url.includes("ada") && url.includes("example.co.uk"))).toBe(false);
    expect(found).toMatchObject({ kind: "settings", settings: { imapHost: "imap.example.co.uk", source: "ispdb" } });
  });
});
