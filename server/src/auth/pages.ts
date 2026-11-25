import { PAGE_STYLE } from "./style.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type SetupStep = 1 | 2 | 3;

export interface LayoutInput {
  title: string;
  heading: string;
  lede?: string;
  body: string;
  step?: SetupStep;
  scripts?: string;
}

const STEP_LABELS: Record<SetupStep, string> = {
  1: "Claim your server",
  2: "Connect your mail",
  3: "Add it to Claude",
};

function stepBar(step?: SetupStep): string {
  if (!step) return "";
  const items = ([1, 2, 3] as SetupStep[]).map((n) => {
    const done = n < step;
    const current = n === step;
    const mark = done ? "✓ " : `${n} `;
    const cls = current ? " current" : done ? " done" : "";
    const aria = current ? ` aria-current="step"` : "";
    return `<li class="${cls.trim()}"${aria}>${mark}${escapeHtml(STEP_LABELS[n])}</li>`;
  }).join("");
  return `<nav class="steps" aria-label="Setup steps">
<p class="steps-phone">Step ${step} of 3 · ${escapeHtml(STEP_LABELS[step])}</p>
<ol class="steps-full">${items}</ol>
</nav>`;
}

export function layout(input: LayoutInput): string {
  const lede = input.lede ? `<p class="lede">${input.lede}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(input.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<p class="brand">Chatterbuilt Mail</p>
${stepBar(input.step)}
</header>
<main>
<div class="card">
<h1>${escapeHtml(input.heading)}</h1>
${lede}
${input.body}
</div>
</main>
<footer class="site-foot"><p>Chatterbuilt Mail is open source.</p></footer>
</div>
${input.scripts ?? ""}
</body>
</html>`;
}

function alertBox(kind: "error" | "ok", text: string): string {
  if (!text) return "";
  const role = kind === "error" ? ` role="alert"` : "";
  const mark = kind === "ok" ? "✓ " : "";
  return `<div class="callout ${kind}"${role}>${mark}${escapeHtml(text)}</div>`;
}

function copyBox(id: string, value: string, label: string): string {
  return `<div class="copy-box">
<code id="${escapeHtml(id)}" class="copy-value">${escapeHtml(value)}</code>
<button type="button" class="btn-quiet" data-copy="${escapeHtml(id)}">${escapeHtml(label)}</button>
</div>`;
}

export function pageScript(nonce: string, extra = ""): string {
  return `<script nonce="${escapeHtml(nonce)}">
(function () {
  function selectNode(el) {
    if (!el) return;
    if (typeof el.select === "function") { el.select(); return; }
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      var value = ("value" in el && el.value) ? el.value : (el.textContent || "");
      if (!value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).catch(function () { selectNode(el); });
      } else {
        selectNode(el);
      }
    });
  });
  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-toggle-password"));
      if (!el) return;
      var show = el.type === "password";
      el.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
    });
  });
  ${extra}
})();
</script>`;
}

function field(input: {
  id: string;
  name: string;
  label: string;
  type?: string;
  value?: string;
  autocomplete?: string;
  inputmode?: string;
  hint?: string;
  required?: boolean;
  invalid?: boolean;
  minlength?: number;
  maxlength?: number;
  toggle?: boolean;
}): string {
  const hintId = input.hint ? `${input.id}-hint` : "";
  const described = hintId ? ` aria-describedby="${hintId}"` : "";
  const invalid = input.invalid ? ` aria-invalid="true"` : "";
  const required = input.required ? " required" : "";
  const auto = input.autocomplete ? ` autocomplete="${escapeHtml(input.autocomplete)}"` : "";
  const mode = input.inputmode ? ` inputmode="${escapeHtml(input.inputmode)}"` : "";
  const min = input.minlength ? ` minlength="${input.minlength}"` : "";
  const max = input.maxlength ? ` maxlength="${input.maxlength}"` : "";
  const value = input.value ? ` value="${escapeHtml(input.value)}"` : "";
  const control = `<input id="${escapeHtml(input.id)}" name="${escapeHtml(input.name)}" type="${input.type ?? "text"}"${auto}${mode}${min}${max}${required}${invalid}${described}${value}>`;
  const toggle = input.toggle
    ? `<button type="button" class="btn-quiet" data-toggle-password="${escapeHtml(input.id)}">Show</button>`
    : "";
  const row = input.toggle ? `<div class="field-row">${control}${toggle}</div>` : control;
  const hint = input.hint ? `<span class="hint" id="${hintId}">${escapeHtml(input.hint)}</span>` : "";
  return `<div class="field">
<label for="${escapeHtml(input.id)}">${escapeHtml(input.label)}</label>
${row}
${hint}
</div>`;
}

export function setupPage(csrf: string, error?: string, nonce?: string, cronLimited = false, invalid?: "secret" | "passphrase" | "confirm"): string {
  const cron = cronLimited
    ? `<p class="hint">Overnight checks are off until <code>CRON_SECRET</code> is set in Vercel. Mail still updates while the app is open.</p>`
    : "";
  const extra = `var tz = document.getElementById("tz"); if (tz) tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone;`;
  const script = nonce ? pageScript(nonce, extra) : "";
  return layout({
    title: "Claim your mail server",
    heading: "Claim your mail server",
    lede: "Paste the setup secret from Vercel, then choose a passphrase you will use to sign in.",
    step: 1,
    scripts: script,
    body: `
<div class="need">
<h2>You'll need</h2>
<ul>
<li>the setup secret: the <code>CBM_SECRET</code> value you typed into Vercel (<strong>Project → Settings → Environment Variables</strong>);</li>
<li>a passphrase you'll remember.</li>
</ul>
</div>
${alertBox("error", error ?? "")}
${cron}
<form method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="timezone" id="tz" value="">
${field({
    id: "secret",
    name: "secret",
    label: "Setup secret",
    type: "password",
    autocomplete: "off",
    required: true,
    invalid: invalid === "secret",
    toggle: true,
  })}
${field({
    id: "passphrase",
    name: "passphrase",
    label: "Passphrase",
    type: "password",
    autocomplete: "new-password",
    required: true,
    invalid: invalid === "passphrase" || invalid === "confirm",
    minlength: 12,
    maxlength: 512,
    hint: "At least 12 characters. Four random words are easy to remember and hard to guess. Save it in your password manager.",
  })}
${field({
    id: "confirm",
    name: "confirm",
    label: "Confirm passphrase",
    type: "password",
    autocomplete: "new-password",
    required: true,
    invalid: invalid === "confirm",
    minlength: 12,
    maxlength: 512,
  })}
<button type="submit" class="btn-primary">Claim this server</button>
</form>
<details class="skip">
<summary>Why do I need this?</summary>
<p>The setup secret proves you own this deployment. The passphrase is how you sign in later. Nothing is copied until you connect a mailbox.</p>
</details>`,
  });
}

/**
 * Google console names, read 2026-11-06:
 * Create a project: https://console.cloud.google.com/
 * Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
 * Branding: https://console.developers.google.com/auth/branding
 *   from https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid (Configure your OAuth consent screen).
 * Audience: Google Auth Platform → Audience. User type External, publishing status In production.
 *   https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification (App audience phases, read 2026-11-06).
 * Testing refresh tokens expire in 7 days:
 *   https://developers.google.com/identity/protocols/oauth2 (Refresh token expiration, read 2026-11-06).
 * Data Access: https://console.developers.google.com/auth/scopes
 * Clients: https://console.developers.google.com/auth/clients
 *   Create client → Application type Web application. Authorized redirect URIs.
 * Workspace trust, Admin console (last updated 2026-10-26, read 2026-11-06):
 *   Security → Access and data control → API controls → Manage Third-Party App Access → Add app
 *   (the live help page names the control Add app, not Configure new app)
 *   https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data
 *   Choose OAuth App Name or Client ID, search by client ID, Select, then Trusted, Configure.
 * Microsoft registration:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app (updated 2026-05-14, read 2026-11-06)
 *   Entra ID → App registrations → New registration.
 *   Supported account types: Any Entra ID Tenant + Personal Microsoft accounts, or Single tenant only.
 * Claude custom connector, read 2026-11-06:
 *   https://claude.com/docs/connectors/custom/remote-mcp
 *   Free, Pro, Max, Ultra: Customize → Connectors → Add custom connector → enter the URL → Add.
 *   Team and Enterprise: an owner adds it under Organization settings → Connectors → Add → Custom.
 *   Then Connect, then sign in and Allow on this server.
 *   MCP path is /mcp (server/vercel.json).
 */
export interface OtherMailForm {
  email: string;
  host: string;
  port: string;
  security: "" | "tls" | "starttls";
  user: string;
  smtpHost: string;
  smtpPort: string;
  helpUrl: string;
  helpLabel: string;
  note: string;
  discoveredHost: string;
  discoveredSmtp: string;
  serverKeepsSent: boolean;
  provider?: string;
}

export interface ConnectedAccount {
  id: string;
  email: string;
  kind: "gmail" | "imap" | "microsoft";
}

const HELP_HOSTS = new Set([
  "support.apple.com",
  "help.yahoo.com",
  "help.aol.com",
  "www.fastmail.help",
  "www.zoho.com",
  "hilfe.gmx.net",
  "support.mail.com",
  "proton.me",
]);

const PROVIDER_NAMES: Record<string, string> = {
  icloud: "iCloud Mail",
  yahoo: "Yahoo Mail",
  aol: "AOL Mail",
  fastmail: "Fastmail",
  zoho: "Zoho Mail",
  gmx: "GMX",
  "mail.com": "mail.com",
  imap: "your provider",
};

function helpLink(url: string, label: string): string {
  if (!url || !label) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !HELP_HOSTS.has(parsed.hostname)) return "";
  } catch {
    return "";
  }
  return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></p>`;
}

function providerLabel(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

function otherSection(csrf: string, other?: OtherMailForm, open = false): string {
  const form = other ?? {
    email: "",
    host: "",
    port: "",
    security: "",
    user: "",
    smtpHost: "",
    smtpPort: "",
    helpUrl: "",
    helpLabel: "",
    note: "",
    discoveredHost: "",
    discoveredSmtp: "",
    serverKeepsSent: false,
  };
  const tls = form.security !== "starttls" ? " selected" : "";
  const starttls = form.security === "starttls" ? " selected" : "";
  const found = Boolean(form.discoveredHost);
  const miss = Boolean(form.note) && !found;
  const shouldOpen = open || found || miss || Boolean(form.host);
  const name = providerLabel(form.provider ?? "");
  const foundCopy = found
    ? `<p>We found the settings for ${escapeHtml(name)}.</p>`
    : "";
  const missCopy = miss && !form.discoveredHost
    ? alertBox("error", form.note)
    : form.note && found
      ? `<p class="hint">${escapeHtml(form.note)}</p>`
      : "";
  const appStep = form.helpUrl
    ? `<li>
<p>Make an app password at ${escapeHtml(name)}.</p>
${helpLink(form.helpUrl, form.helpLabel)}
<p class="hint">${escapeHtml(name)} doesn't let other apps use your normal password.</p>
</li>`
    : `<li>
<p>Make an app password at your mail provider. That provider doesn't let other apps use your normal password.</p>
</li>`;
  const manualHint = miss
    ? `<p>Type the IMAP and SMTP hosts from your mail provider's help page.</p>`
    : "";
  return `<details class="option"${shouldOpen ? " open" : ""}>
<summary>Other email</summary>
<p class="lede">iCloud, Yahoo, AOL, Fastmail, Zoho and others.</p>
${foundCopy}
${missCopy}
<form method="post" action="/connect/other">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="discoveredHost" value="${escapeHtml(form.discoveredHost)}">
<input type="hidden" name="discoveredSmtp" value="${escapeHtml(form.discoveredSmtp)}">
<input type="hidden" name="serverKeepsSent" value="${form.serverKeepsSent ? "1" : "0"}">
<ol class="guide">
<li>
${field({
    id: "other-email",
    name: "email",
    label: "Type your email address",
    type: "email",
    value: form.email,
    autocomplete: "username",
    required: true,
    invalid: miss && !form.email.includes("@"),
  })}
<button type="submit" name="action" value="find">Find settings</button>
</li>
${found || form.host ? appStep : ""}
${found || form.host ? `<li>
${field({
    id: "other-password",
    name: "password",
    label: "Paste the app password",
    type: "password",
    autocomplete: "off",
  })}
<button type="submit" name="action" value="connect" class="btn-primary">Connect</button>
</li>` : `<li>
${field({
    id: "other-password",
    name: "password",
    label: "App password",
    type: "password",
    autocomplete: "off",
  })}
<button type="submit" name="action" value="connect">Connect</button>
</li>`}
</ol>
<details class="skip"${miss || form.host ? " open" : ""}>
<summary>Change server settings</summary>
${manualHint}
${field({ id: "other-host", name: "host", label: "IMAP host", value: form.host, autocomplete: "off" })}
${field({ id: "other-port", name: "port", label: "IMAP port", value: form.port, inputmode: "numeric", autocomplete: "off" })}
<div class="field">
<label for="other-security">Security</label>
<select id="other-security" name="security">
<option value="tls"${tls}>TLS</option>
<option value="starttls"${starttls}>STARTTLS</option>
</select>
</div>
${field({ id: "other-smtp-host", name: "smtpHost", label: "SMTP host", value: form.smtpHost, autocomplete: "off" })}
${field({ id: "other-smtp-port", name: "smtpPort", label: "SMTP port", value: form.smtpPort, inputmode: "numeric", autocomplete: "off" })}
${field({ id: "other-user", name: "user", label: "Username", value: form.user, autocomplete: "username" })}
</details>
</form>
</details>`;
}

function googleScopes(): string {
  const scopes = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/gmail.send",
  ];
  return scopes.map((scope, i) => copyBox(`google-scope-${i}`, scope, "Copy")).join("");
}

function googleSetup(csrf: string, origin: string): string {
  const googleRedirect = `${origin}/connect/google/callback`;
  return `<p>First, give your server its own Google sign-in. This takes about 10 minutes, once.</p>
<ol class="guide">
<li>
<p>Create a Google Cloud project. Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud</a> and choose <strong>New project</strong>.</p>
</li>
<li>
<p>Enable the Gmail API. Open the <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">Gmail API</a> page and choose <strong>Enable</strong>.</p>
</li>
<li>
<p>Open Google Auth Platform → <strong>Branding</strong>. Name the app and save. <a href="https://console.developers.google.com/auth/branding" target="_blank" rel="noopener">Branding</a></p>
</li>
<li>
<p>Open <strong>Audience</strong>. Choose <strong>External</strong>, then <strong>In production</strong>.</p>
<details class="skip">
<summary>Why do I need this?</summary>
<p>Testing drops the connection after 7 days, and you'll click past an "unverified app" screen once. In production, that 7-day limit is gone.</p>
</details>
</li>
<li>
<p><strong>Data Access:</strong> add these three scopes.</p>
${googleScopes()}
<p><a href="https://console.developers.google.com/auth/scopes" target="_blank" rel="noopener">Data Access</a></p>
<details class="skip">
<summary>The scopes list</summary>
<p><code>gmail.modify</code> reads and files mail. <code>gmail.send</code> sends. <code>gmail.settings.basic</code> manages filters.</p>
</details>
</li>
<li>
<p>Open <a href="https://console.developers.google.com/auth/clients" target="_blank" rel="noopener">Clients</a>. Choose <strong>Create client</strong>, then <strong>Web application</strong>. Paste this redirect URI into <strong>Authorized redirect URIs</strong>.</p>
${copyBox("google-redirect", googleRedirect, "Copy")}
</li>
<li>
<p>Paste the <strong>Client ID</strong> and <strong>Client secret</strong> here.</p>
<form method="post" action="/connect/google/client">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${field({ id: "google-client-id", name: "client_id", label: "Client ID", autocomplete: "off", required: true })}
${field({ id: "google-client-secret", name: "client_secret", label: "Client secret", type: "password", autocomplete: "off", required: true })}
<button type="submit" class="btn-primary">Save Google client</button>
</form>
</li>
<li>
<p>Workspace only: in each Admin console open <strong>Security → Access and data control → API controls → Manage Third-Party App Access → Add app</strong>. Search by client ID, then mark it <strong>Trusted</strong>.</p>
</li>
</ol>`;
}

function googleReadyCard(googleSaved: boolean, hasGoogleAccount: boolean): string {
  const another = hasGoogleAccount
    ? `<p><a href="/connect/google">Connect another Google account</a></p>`
    : "";
  const change = googleSaved
    ? `<details class="skip"><summary>Change the saved Google sign-in</summary>
<p>A Google client is saved on this server. Saving a new one replaces it.</p>
</details>`
    : `<p class="hint">This host already has a Google client.</p>`;
  return `<p><a class="btn-primary" href="/connect/google">Sign in with Google</a></p>
${another}
${change}`;
}

function microsoftOwnApp(csrf: string, origin: string, includeForm: boolean): string {
  const microsoftRedirect = `${origin}/connect/microsoft/callback`;
  const form = includeForm
    ? `<form method="post" action="/connect/microsoft/client">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${field({ id: "ms-own-client-id", name: "client_id", label: "Client ID", autocomplete: "off", required: true })}
${field({ id: "ms-own-client-secret", name: "client_secret", label: "Client secret, if this is your own app", type: "password", autocomplete: "off" })}
<button type="submit">Save Microsoft client</button>
</form>`
    : "";
  return `<details class="skip">
<summary>Use my own Microsoft app</summary>
<ol class="guide">
<li>
<p>Sign in to the <a href="https://entra.microsoft.com/" target="_blank" rel="noopener">Microsoft Entra admin center</a>. Open <strong>Entra ID → App registrations → New registration</strong>.</p>
</li>
<li>
<p>For work mail and Outlook.com, choose any organization and personal accounts. If every mailbox is in your own company, choose this organization only.</p>
</li>
<li>
<p>A client ID alone uses a code you type at Microsoft. Leave the secret empty for that. A work account may refuse that code until the app's publisher is verified. Personal Outlook.com does not ask for that.</p>
</li>
<li>
<p>Add a secret only for your own app. Add a Web redirect URI:</p>
${copyBox("microsoft-redirect", microsoftRedirect, "Copy")}
</li>
<li>
<p>Add these permissions: <code>offline_access</code>, <code>openid</code>, <code>email</code>, <code>User.Read</code>, <code>Mail.ReadWrite</code>, <code>Mail.Send</code>, and <code>MailboxSettings.ReadWrite</code>.</p>
</li>
</ol>
${form}
</details>`;
}

function microsoftCard(input: {
  csrf: string;
  origin: string;
  microsoftReady: boolean;
  microsoftDevice: boolean;
  microsoftSaved: boolean;
}): string {
  if (input.microsoftReady) {
    const how = input.microsoftDevice
      ? `<p class="hint">This asks you to type a code at Microsoft.</p>`
      : `<p class="hint">This sends you to Microsoft and back here.</p>`;
    const saved = input.microsoftSaved
      ? `<p class="hint">A Microsoft client is saved on this server.</p>`
      : `<p class="hint">This host already has a Microsoft client.</p>`;
    return `<p><a class="btn-primary" href="/connect/microsoft">Sign in with Microsoft</a></p>
${how}
${saved}
${microsoftOwnApp(input.csrf, input.origin, false)}`;
  }
  return `<p>Default path: save a client ID and use <strong>Sign in with Microsoft</strong> (the device code). Leave the secret empty.</p>
<form method="post" action="/connect/microsoft/client">
<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
${field({ id: "ms-client-id", name: "client_id", label: "Client ID", autocomplete: "off", required: true })}
<button type="submit">Save Microsoft client</button>
</form>
${microsoftOwnApp(input.csrf, input.origin, true)}`;
}

function accountKindLabel(kind: ConnectedAccount["kind"]): string {
  if (kind === "gmail") return "Google";
  if (kind === "microsoft") return "Microsoft";
  return "Other email";
}

function disconnectAction(kind: ConnectedAccount["kind"]): string {
  if (kind === "microsoft") return "/connect/microsoft/disconnect";
  return "/connect/google/disconnect";
}

function accountsList(csrf: string, accounts: ConnectedAccount[]): string {
  if (accounts.length === 0) {
    return `<h2>Your accounts</h2>
<p>No mail connected yet. Pick your kind of email below.</p>`;
  }
  const rows = accounts.map((account) => `
<li>
<span class="mark" aria-hidden="true">✓</span>
<span>${escapeHtml(account.email)}</span>
<span class="hint">${escapeHtml(accountKindLabel(account.kind))}</span>
<form method="post" action="${disconnectAction(account.kind)}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="account" value="${escapeHtml(account.id)}">
<button type="submit" class="link-btn">Disconnect</button>
</form>
</li>`).join("");
  return `<h2>Your accounts</h2>
<ul class="accounts">${rows}</ul>`;
}

function claudePanel(origin: string): string {
  const mcp = `${origin}/mcp`;
  return `<h2>Add it to Claude</h2>
<ol class="guide">
<li>
<p>Copy this address.</p>
${copyBox("mcp-url", mcp, "Copy")}
</li>
<li>
<p>In claude.ai, on Free, Pro, Max, or Ultra, open <strong>Customize → Connectors → Add custom connector</strong>. On Team or Enterprise, an owner adds it under <strong>Organization settings → Connectors → Add → Custom</strong>.</p>
</li>
<li>
<p>Paste the address and choose <strong>Add</strong>, then <strong>Connect</strong>.</p>
</li>
<li>
<p>Sign in with your passphrase and choose <strong>Allow</strong>.</p>
</li>
</ol>
<p class="actions"><a class="btn-primary" href="/app">Open your mail</a></p>`;
}

function errorCard(error?: string, other?: OtherMailForm): "google" | "microsoft" | "other" | "" {
  if (other?.note || (other?.host && other.note)) return "other";
  if (!error) return "";
  if (/microsoft/i.test(error)) return "microsoft";
  if (/google/i.test(error)) return "google";
  return "google";
}

export function connectHubPage(input: {
  csrf: string;
  origin: string;
  googleReady: boolean;
  googleSaved: boolean;
  microsoftReady: boolean;
  microsoftDevice: boolean;
  microsoftSaved: boolean;
  error?: string;
  nonce: string;
  other?: OtherMailForm;
  accounts?: ConnectedAccount[];
}): string {
  const accounts = input.accounts ?? [];
  const open = errorCard(input.error, input.other);
  const googleOpen = open === "google" ? " open" : "";
  const microsoftOpen = open === "microsoft" ? " open" : "";
  const googleBody = input.googleReady
    ? googleReadyCard(input.googleSaved, accounts.some((item) => item.kind === "gmail"))
    : googleSetup(input.csrf, input.origin);
  const googleHeading = input.googleReady ? "Gmail or Google Workspace" : "Gmail or Google Workspace";
  return layout({
    title: "Connect your mail",
    heading: "Connect your mail",
    lede: "Pick the account you want to read. Nothing is copied until you sign in.",
    step: 2,
    scripts: pageScript(input.nonce),
    body: `
${accountsList(input.csrf, accounts)}
${alertBox("error", input.error ?? "")}
<details class="option"${googleOpen}>
<summary>${googleHeading}</summary>
${googleBody}
</details>
<details class="option"${microsoftOpen}>
<summary>Outlook, Hotmail or Microsoft 365</summary>
${microsoftCard(input)}
</details>
${otherSection(input.csrf, input.other, open === "other")}
${accounts.length > 0 ? claudePanel(input.origin) : ""}`,
  });
}

export function signInPage(csrf: string, error?: string, next?: string, wait?: string): string {
  const note = wait || error || "";
  const nextField = next === "/app" ? `<input type="hidden" name="next" value="/app">` : "";
  return layout({
    title: "Sign in",
    heading: "Sign in",
    lede: "Use the passphrase you chose when you claimed this server.",
    body: `
${alertBox("error", note)}
<form method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${nextField}
${field({
    id: "passphrase",
    name: "passphrase",
    label: "Passphrase",
    type: "password",
    autocomplete: "current-password",
    required: true,
    invalid: Boolean(error) && !wait,
  })}
<button type="submit" class="btn-primary">Continue</button>
</form>`,
  });
}

export function consentPage(csrf: string, clientName: string, redirectHost: string, clientHost?: string): string {
  const name = escapeHtml(clientName || "This app");
  const who = `<p><strong>${name}</strong> is asking to use your mail.</p>`;
  const hosted = clientHost ? `<p>This client is at ${escapeHtml(clientHost)}.</p>` : "";
  return layout({
    title: "Let Claude use your mail?",
    heading: "Let Claude use your mail?",
    lede: `After you allow, you go back to ${escapeHtml(redirectHost)}.`,
    body: `
${who}
${hosted}
<p>It will be able to:</p>
<ul>
<li>read and search your mail</li>
<li>write drafts</li>
<li>send</li>
<li>label and move</li>
<li>manage filters</li>
</ul>
<form method="post" class="actions">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="decision" value="allow">
<button type="submit" class="btn-primary">Allow</button>
</form>
<form method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="decision" value="deny">
<button type="submit" class="link-btn">Cancel</button>
</form>`,
  });
}

export function signedInPage(microsoft = false): string {
  const microsoftLink = microsoft ? `<p><a href="/connect/microsoft">Connect Microsoft</a></p>` : "";
  return layout({
    title: "Signed in",
    heading: "Signed in",
    lede: "You can connect a mailbox now. This does not copy your mail yet.",
    body: `
<p class="actions"><a class="btn-primary" href="/connect/google">Connect Gmail</a></p>
${microsoftLink}
<p><a href="/connect">Connect your mail</a></p>
<p><a href="/app">Open your mail</a></p>`,
  });
}

export function microsoftStartPage(csrf: string): string {
  return layout({
    title: "Connect Microsoft",
    heading: "Connect Microsoft",
    lede: "This starts a code you type at Microsoft. Nothing is copied yet.",
    step: 2,
    body: `
<form method="post">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button type="submit" class="btn-primary">Start</button>
</form>`,
  });
}

/** The device code itself is never put in this page. */
export function microsoftDevicePage(userCode: string, verificationUri: string, intervalSeconds: number, nonce: string): string {
  const interval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? Math.floor(intervalSeconds) : 5;
  return layout({
    title: "Connect Microsoft",
    heading: "Connect Microsoft",
    lede: "Open microsoft.com/devicelogin, type this code, and sign in. This page finishes by itself.",
    step: 2,
    scripts: `<script nonce="${escapeHtml(nonce)}">
(function () {
  var wait = document.getElementById("wait");
  var interval = Number(wait.getAttribute("data-interval")) || 5;
  function selectNode(el) {
    if (!el) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.getElementById("copy-code").addEventListener("click", function () {
    var code = document.getElementById("user-code").textContent || "";
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(function () { selectNode(document.getElementById("user-code")); });
    } else {
      selectNode(document.getElementById("user-code"));
    }
  });
  function poll() {
    fetch("/connect/microsoft/device/status", { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body && body.status === "done") { wait.textContent = "Microsoft is connected."; return; }
        if (body && body.status === "error") { wait.textContent = body.message || "Microsoft sign-in did not finish."; return; }
        if (body && typeof body.interval === "number" && body.interval > 0) interval = body.interval;
        setTimeout(poll, interval * 1000);
      })
      .catch(function () { setTimeout(poll, interval * 1000); });
  }
  setTimeout(poll, interval * 1000);
})();
</script>`,
    body: `
<ol class="guide">
<li>
<p>Copy this code.</p>
<p id="user-code">${escapeHtml(userCode)}</p>
<p><button type="button" id="copy-code" class="btn-quiet">Copy</button></p>
</li>
<li>
<p>Open microsoft.com/devicelogin.</p>
<p><a class="btn-primary" id="verify-link" href="${escapeHtml(verificationUri)}" target="_blank" rel="noopener">Open Microsoft</a></p>
</li>
<li>
<p>Paste the code and sign in.</p>
</li>
<li>
<p>Come back here. This page updates by itself.</p>
</li>
</ol>
<p id="wait" data-interval="${interval}" aria-live="polite">Waiting for Microsoft.</p>`,
  });
}

function connectedBody(csrf: string, email: string, accountId: string, action: string): string {
  return `
${alertBox("ok", `This server will use ${email}.`)}
<p>Nothing has been copied yet. A sync starts when a client calls sync now, or when the daily cron runs.</p>
<p class="actions">
<a class="btn-primary" href="/connect">Connect another account</a>
<a href="/app">Open your mail</a>
</p>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<input type="hidden" name="account" value="${escapeHtml(accountId)}">
<button type="submit" class="link-btn">Disconnect</button>
</form>`;
}

export function microsoftConnectedPage(csrf: string, email: string, accountId: string): string {
  return layout({
    title: "Microsoft connected",
    heading: "Microsoft connected",
    step: 2,
    body: connectedBody(csrf, email, accountId, "/connect/microsoft/disconnect"),
  });
}

export function messagePage(title: string, text: string): string {
  return layout({
    title,
    heading: title,
    body: `<p>${escapeHtml(text)}</p>`,
  });
}

export function connectedPage(csrf: string, email: string, accountId: string): string {
  return layout({
    title: "Gmail connected",
    heading: "Gmail connected",
    step: 2,
    body: connectedBody(csrf, email, accountId, "/connect/google/disconnect"),
  });
}

export function signInFirstPage(product = "Gmail"): string {
  return layout({
    title: "Sign in first",
    heading: "Sign in first",
    lede: `Open the sign-in page, type the passphrase, then come back to connect ${escapeHtml(product)}.`,
    body: `<p class="actions"><a class="btn-primary" href="/signin">Sign in</a></p>`,
  });
}
