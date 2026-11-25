import { createHash } from "node:crypto";

/**
 * One static stylesheet for every page `pages.ts` renders.
 * Hashed once at load for CSP `style-src 'sha256-…'`. Inline `style=""` stays forbidden.
 */
export const PAGE_STYLE = `:root {
  color-scheme: light;
  --bg: #f3f5f9;
  --fg: #0d1117;
  --muted: #5b6372;
  --line: rgba(15, 23, 42, 0.085);
  --line-2: rgba(15, 23, 42, 0.16);
  --accent: #2563eb;
  --ok: #15803d;
  --surface: #ffffff;
  --error: #b42318;
  --error-bg: #fef2f2;
  --ok-bg: #f0fdf4;
  --need-bg: rgba(37, 99, 235, 0.08);
  --accent-ink: #ffffff;
  --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9aa4b2;
    --line: rgba(230, 237, 243, 0.12);
    --line-2: rgba(230, 237, 243, 0.24);
    --accent: #6ea8fe;
    --ok: #3dd68c;
    --surface: #161b22;
    --error: #ff8a80;
    --error-bg: rgba(255, 138, 128, 0.12);
    --ok-bg: rgba(61, 214, 140, 0.12);
    --need-bg: rgba(110, 168, 254, 0.12);
    --accent-ink: #0d1117;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { max-width: 100%; }
html, body { margin: 0; min-height: 100%; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }
summary { min-height: 44px; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.wrap {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  padding-top: 20px;
  padding-bottom: max(32px, env(safe-area-inset-bottom));
}
.brand {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.steps { margin: 0 0 20px; }
.steps-full {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 0;
  padding: 0;
  font-size: 13px;
  color: var(--muted);
}
.steps-full li { display: flex; align-items: center; gap: 6px; }
.steps-full .current { color: var(--fg); font-weight: 650; }
.steps-full .done { color: var(--ok); }
.steps-phone { display: none; margin: 0; font-size: 14px; color: var(--muted); font-weight: 650; }
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 24px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.02em;
  text-wrap: balance;
}
.lede, .run, p {
  max-width: 65ch;
}
.lede {
  margin: 0 0 20px;
  color: var(--muted);
}
.need {
  margin: 0 0 20px;
  padding: 12px 14px;
  background: var(--need-bg);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.need h2 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 650;
}
.need ul { margin: 0; padding-left: 1.2em; }
.need li { margin: 0 0 4px; }
.callout {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
}
.callout.error {
  background: var(--error-bg);
  border-color: var(--error);
  color: var(--fg);
}
.callout.ok {
  background: var(--ok-bg);
  border-color: var(--ok);
}
.field { margin: 0 0 16px; }
.field label {
  display: block;
  font-weight: 650;
  margin-bottom: 6px;
}
.hint {
  display: block;
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 15px;
}
.field-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.field-row input { flex: 1 1 auto; min-width: 0; }
input[type="text"], input[type="email"], input[type="password"], input[type="number"], select, textarea {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line-2);
  border-radius: 8px;
}
input[aria-invalid="true"], select[aria-invalid="true"] {
  border-color: var(--error);
}
.btn, button[type="submit"]:not(.link-btn), .btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 16px;
  font: inherit;
  font-weight: 650;
  color: var(--accent-ink);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
}
.btn-primary { width: auto; }
button[type="button"], .btn-quiet {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
  min-height: 44px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 650;
  color: var(--fg);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  cursor: pointer;
}
.link-btn {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  font: inherit;
  font-weight: 650;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}

ol.guide {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  counter-reset: step;
}
ol.guide > li {
  position: relative;
  margin: 0 0 16px;
  padding-left: 2.75rem;
  counter-increment: step;
  max-width: 65ch;
}
ol.guide > li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  font-weight: 650;
  font-size: 15px;
  color: var(--accent);
  background: var(--need-bg);
  border-radius: 999px;
}
.copy-box {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 8px 0;
}
.copy-box code, .copy-box .copy-value, #user-code {
  flex: 1 1 auto;
  min-width: 0;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: 8px;
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
}
#user-code {
  display: block;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-align: center;
}
.accounts { list-style: none; margin: 0 0 20px; padding: 0; }
.accounts li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.accounts .mark { color: var(--ok); font-weight: 650; }
.option {
  margin: 0 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 4px 14px 12px;
}
.option > summary {
  cursor: pointer;
  font-weight: 650;
  font-size: 18px;
  padding: 12px 0;
  list-style: none;
}
.option > summary::-webkit-details-marker { display: none; }
.skip { margin: 16px 0; }
.skip > summary { cursor: pointer; font-weight: 650; color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-top: 8px; }
.site-foot {
  margin-top: 20px;
  color: var(--muted);
  font-size: 14px;
}
@media (max-width: 480px) {
  .card { padding: 20px; }
  h1 { font-size: 24px; }
  .btn-primary, button[type="submit"]:not(.link-btn) { width: 100%; }
  .steps-full { display: none; }
  .steps-phone { display: block; }
}
`;

export const PAGE_STYLE_HASH = createHash("sha256").update(PAGE_STYLE).digest("base64");
export const PAGE_STYLE_CSP = `style-src 'sha256-${PAGE_STYLE_HASH}'`;
