# Decision: connect any mailbox, and make setup easy

Date: 2026-11-05. Asked by Mark: "Let's do the IMAP and steelman the decision." And: "Can we make the setup for a user much easier? Could they OAuth into their email accounts?"

## What we're deciding

1. Build IMAP now, before the dogfood window ends, instead of after it.
2. Let people sign in to their mail with OAuth wherever the provider allows it, instead of typing server names and passwords.

## The case for doing it now

- **The beta is for other people.** The Personal Edition beta opens Dec 14. Mark said he wants Chatterbuilt Mail for people who aren't on Gmail. A beta that only takes Gmail tests the wrong thing.
- **The expensive part is the shape, not the protocol.** Today one deployment speaks to one provider (`MAIL_PROVIDER`). Someone with Gmail and iCloud can't use it. Changing that to per-account routing is cheap now and expensive after a beta of real users.
- **Dogfood still covers it.** Mark's three Gmail accounts will run through the new router every day. The router is the risky shared piece, and it gets real mail.
- **Setup is the biggest wall.** Today a user makes a Google Cloud project, an OAuth client and an External app, then trusts it in each Admin console, sets eight env vars, and deploys. Most of Rosa's peers stop at step one.

## The case against

- **None of the dogfood accounts are IMAP.** IMAP code gets no real-mail use before strangers use it. Fakes and a local test server don't hit iCloud's or Yahoo's quirks.
- **"IMAP" doesn't reach the biggest non-Gmail group.** Among the Inc. 5000 fastest-growing US companies, 35% route mail to Microsoft 365 by MX record, against 41% on Google Workspace ([WhoAPI, 2023](https://whoapi.com/blog/fastest-growing-companies-installed-these-business-email-solutions/)). Password sign-in is gone or going there:
  - Outlook.com stopped accepting basic authentication on Sept 16, 2024 ([Microsoft](https://support.microsoft.com/en-US/support/known-issues/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-ap)).
  - Exchange Online turns off basic auth for SMTP by default at the end of December 2026. The final removal date is due in the second half of 2027 ([MC786329](https://mc.merill.net/message/MC786329?from=1&to=4)).
  - With security defaults on, SMTP AUTH is already off in Exchange Online ([Microsoft](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)).
- **IMAP isn't Gmail.** It has folders, not labels. It has no thread ids and no server-side filters. It has dozens of server quirks. Every Gmail-shaped feature the page has needs a mapping, and some don't map at all.
- **One-click Google for strangers costs real money.** Gmail's `gmail.modify` scope is restricted. A shared app needs Google's verification and a security assessment, which Google puts at $15,000–$75,000 and which takes weeks to months ([Nylas](https://www.nylas.com/?p=1231)). It also puts Chatterbuilt in every customer's token refresh, because a Google web client can't refresh without its secret. That cuts against "you own it, and it works if you disconnect."
- **It competes with dogfood for attention.** Dogfood ends Nov 20.

## What we decided

Build it, but in the order that matches who it serves, and keep Chatterbuilt out of the token path.

| Mail | How they connect | OAuth? |
|---|---|---|
| Gmail and Google Workspace | Sign in with Google, using the owner's own Google client. A guided page makes the client in about ten minutes, and the client is saved on the server, so no env vars and no redeploy. | Yes. One-click with a shared Chatterbuilt client waits for Mark's call on the cost (above). |
| Outlook.com and Microsoft 365 | Sign in with Microsoft, through Microsoft Graph rather than IMAP. | Yes. Chatterbuilt's shared app signs in with a short device code, so there's no secret and Chatterbuilt never sees a token. Owners can bring their own Microsoft app for a one-click redirect instead. |
| iCloud, Yahoo, AOL, Fastmail, Zoho, and hosting providers | Email address plus an app password. The server finds the server settings itself and links to the provider's app-password page. | No. iCloud has no OAuth for mail and asks for an app-specific password ([Apple](https://support.apple.com/en-me/102525)). Yahoo's mail scopes need an approved application ([Yahoo](https://senders.yahooinc.com/developer/developer-access)). |

Why Graph for Microsoft instead of IMAP with OAuth:
- Graph has real threads (`conversationId`).
- Graph categories behave like Gmail labels.
- Graph has inbox rules, so filters work.
- Graph sends without SMTP AUTH, which tenants often turn off.
- Graph has delta sync.

IMAP with OAuth would still need SMTP AUTH enabled per mailbox.

### How Microsoft sign-in works without a Chatterbuilt secret

Corrected 2026-11-05, after Lane 5c's plan (PR #8). The first version of this section described a static relay page in front of a public client. Microsoft's identity platform doesn't support that:

- a fixed `https` redirect that a server redeems needs a Web app and a client secret;
- a single-page-app redirect must be redeemed from a browser;
- a public client's redirects are `localhost`, Microsoft's `nativeclient` URL or a custom scheme, not our domain ([auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [desktop app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)).

So there are two ways in, and both keep Chatterbuilt out of the token path:

1. **Chatterbuilt's shared app, with device-code sign-in.**
   - The server asks Microsoft for a short code.
   - The person opens microsoft.com/devicelogin, types the code, and signs in.
   - The server polls Microsoft and receives the tokens itself.
   - There is no secret, no relay and no redirect ([device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)).
   - The cost: one extra screen, and some work tenants turn device code off.
2. **The owner's own Entra web app.** Its own client ID and secret, and a normal "Sign in with Microsoft" redirect to `https://<host>/connect/microsoft/callback`. This works in tenants that block device code. A single-tenant app needs no publisher verification for its own users.

Publisher verification for the shared app is free, but needs a Microsoft AI Cloud Partner Program account. Without it, many work tenants block user consent to a new multitenant app ([Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).

### Testing, so "it works" means something

- Hermetic tests on every lane: PGlite, fake providers, no network.
- IMAP also runs a live suite against a real Dovecot on localhost, twice:
  - once full-featured (MOVE, UIDPLUS, CONDSTORE, QRESYNC, SPECIAL-USE);
  - once with those turned off, so every fallback path runs.
- SMTP runs against Nodemailer's `smtp-server` in process.
- Folder-name quirks for iCloud, Yahoo, and Outlook are fixtures.
- Microsoft runs against a fake Graph HTTP server that records every request, the same pattern as the fake Gmail server.
- What can't be proven without a real account is listed as a dogfood item: one iCloud or Fastmail account and one Outlook.com account.

## Human-only steps (Mark)

- **Microsoft shared app:** register an Entra app (personal and work accounts, "Allow public client flows" on) in a work tenant, then do publisher verification through the Cloud Partner Program. A client ID isn't a secret, so it can live in config.
- **Google shared app (optional, later):** decide whether to pay for verification and the security assessment. Until then, owners bring their own client.
- **Yahoo OAuth (optional, later):** apply for Yahoo's mail API access. Until then, Yahoo uses app passwords.
