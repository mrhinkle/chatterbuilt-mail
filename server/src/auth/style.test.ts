import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAGE_STYLE, PAGE_STYLE_CSP, PAGE_STYLE_HASH } from "./style.js";
import { connectHubPage, messagePage, setupPage, signInPage } from "./pages.js";

describe("auth page stylesheet", () => {
  it("hashes the exact stylesheet string", () => {
    expect(createHash("sha256").update(PAGE_STYLE).digest("base64")).toBe(PAGE_STYLE_HASH);
    expect(PAGE_STYLE_CSP).toBe(`style-src 'sha256-${PAGE_STYLE_HASH}'`);
  });

  it("embeds that stylesheet and has no inline style attributes", () => {
    const pages = [
      setupPage("csrf", "That setup secret is not right.", "nonce", true, "secret"),
      signInPage("csrf", "That passphrase is not right."),
      connectHubPage({
        csrf: "csrf",
        origin: "https://mail.example.test",
        googleReady: false,
        googleSaved: false,
        microsoftReady: false,
        microsoftDevice: false,
        microsoftSaved: false,
        nonce: "nonce",
        error: "That Google client is not valid. The client ID ends in .apps.googleusercontent.com.",
      }),
      messagePage("Setup is closed", "This server already has an owner. Sign in."),
    ];
    for (const html of pages) {
      expect(html).toContain(`<style>${PAGE_STYLE}</style>`);
      expect(html.includes("style=\"")).toBe(false);
    }
  });
});
