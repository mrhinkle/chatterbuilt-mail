// Builds the demo page the way the artifact host serves it. With { accounts: true }, Gmail goes through Composio with
// two made-up accounts (Rivera Labs and Personal), so the account switcher shows.
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const ACCOUNTS = '    gmail: { via: "composio", accounts: [{ id: "gmail_work", email: "alex@riveralabs.example", label: "Rivera Labs" }, { id: "gmail_personal", email: "alex.rivera@mail.example", label: "Personal" }] },\n';
module.exports = function buildPage(name, opts) {
  opts = opts || {};
  let cfg = path.join(__dirname, 'demo.config.js');
  if (opts.accounts) {
    const src = fs.readFileSync(cfg, 'utf8'); const at = src.indexOf('\n', src.indexOf('ownEmail:')) + 1;
    cfg = path.join(os.tmpdir(), name + '.config.js'); fs.writeFileSync(cfg, src.slice(0, at) + ACCOUNTS + src.slice(at));
  }
  const built = path.join(os.tmpdir(), name + '.built.html');
  execFileSync('python3', [path.join(ROOT, 'scripts/build.py'), path.join(ROOT, 'skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html'), cfg, built], { stdio: 'ignore' });
  const page = path.join(os.tmpdir(), name + '.html');
  fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + fs.readFileSync(built, 'utf8') + '</body></html>');
  return page;
};
