#!/bin/bash
# The page's regression suites (Playwright, made-up data only; nothing touches a real account).
# Builds every test page from the current template, then runs every suite, one at a time.
# usage: bash tests/page/run-all.sh            (from anywhere)
#        bash tests/page/run-all.sh cache bar  (only the named suites)
# Needs Node 18+, Python 3 and Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
set -u
# macOS has no timeout(1). Keep the same 400s cap: perl's alarm survives exec and stops the suite.
if ! command -v timeout >/dev/null 2>&1; then
  timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV or die $!' "$s" "$@"; }
fi
S="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$S/../.." && pwd)"; T=$R/skills/chatterbuilt-mail-setup/assets/chatterbuilt-mail.template.html
O="$S/out"; mkdir -p "$O"
# harness_att.js renders a PDF with pdfjs-dist from tests/page/node_modules.
# pdfjs-dist is a devDependency. npm omits those when NODE_ENV=production unless --include=dev.
[ -f "$S/node_modules/pdfjs-dist/build/pdf.min.js" ] || (cd "$S" && npm ci --include=dev --no-audit --no-fund >/dev/null 2>&1) || echo "INSTALL FAIL tests/page (npm ci)"
cd "$R"
for c in mark_native:mark demo:demo cc:cc composio:composio gx:gx all:all hosted:hosted setup:setup setup-composio:setup-composio setup-native:setup-native setup-bare:setup-bare setup-xss:setup-xss; do python3 scripts/build.py "$T" "$S/configs/${c%%:*}.config.js" "$O/${c##*:}.html" >/dev/null || echo "BUILD FAIL $c"; done
python3 scripts/build.py "$T" examples/config.full.example.js "$O/example.html" >/dev/null || echo "BUILD FAIL example"
cd "$O"
ONLY=" $* "
fails=0
run() { local name=$1; shift; if [ -n "${ONLY// /}" ] && [[ "$ONLY" != *" $name "* ]]; then return; fi
  local out; out=$(timeout 400 node "$@" 2>&1 | tail -60); local line; line=$(echo "$out" | grep -E "passed|PASSED|CRASH" | tail -1); echo "$name: $line"; echo "$out" | grep -E "^FAIL|CRASH" | head -8
  if [ -z "$line" ] || echo "$out" | grep -qE "^FAIL|CRASH"; then fails=$((fails+1)); fi; }
run harness $S/harness.js $O/mark.html $O/o_h
run hub $S/harness_hub.js $O/mark.html $O/o_hub
run page-mark $S/harness_page.js $O/mark.html $O/o_pm
run page-example $S/harness_page.js $O/example.html $O/o_pe
run unsub $S/harness_unsub.js $O/demo.html $O/o_u
run fixes $S/harness_fixes.js $O/demo.html $O/o_f
run panel $S/harness_panel.js $O/demo.html $O/o_p
run retry $S/harness_retry.js $O/demo.html $O/o_r
run panes $S/harness_panes.js $O/demo.html $O/o_pn
run resize $S/harness_resize.js $O/demo.html $O/o_rs
run composio $S/harness_composio.js $O/composio.html $O/o_c
run gx $S/harness_gx.js $O/gx.html $O/o_gx
run att $S/harness_att.js $O/demo.html $O/gx.html $O/o_att
run all $S/harness_all.js $O/all.html $O/o_all
run ui $S/harness_ui.js $O/demo.html $O/o_ui
run triage $S/harness_triage.js $O/demo.html $O/o_tri
run cc $S/harness_cc.js $O/cc.html $O/demo.html $O/gx.html $O/o_cc
run drafts $S/harness_drafts.js $O/demo.html $O/gx.html $O/o_dr $O/cc.html
run multi $S/harness_multi.js $O/demo.html $O/gx.html $O/o_mu
run sig $S/harness_sig.js $O/demo.html $O/gx.html $O/o_sig
run from $S/harness_from.js $O/demo.html $O/gx.html $O/o_from
run compose $S/harness_compose.js $O/demo.html $O/o_comp
run refresh $S/harness_refresh.js $O/demo.html $O/o_ref
run then $S/harness_then.js $O/cc.html $O/o_then
run view $S/harness_view.js $O/demo.html $O/all.html $O/o_view
run delete $S/harness_delete.js $O/demo.html $O/gx.html $O/o_del
run review $S/harness_review.js $O/demo.html $O/gx.html $O/o_rev
run rte $S/harness_rte.js $O/demo.html $O/gx.html $O/o_rte
run speed $S/harness_speed.js $O/demo.html $O/gx.html $O/o_speed
run dattach $S/harness_dattach.js $O/demo.html $O/gx.html $O/o_dattach
run dprompt $S/harness_dprompt.js $O/demo.html $O/o_dprompt
run dbatch $S/harness_dbatch.js $O/demo.html $O/gx.html $O/o_dbatch
run bar $S/harness_bar.js $O/demo.html $O/o_bar 1500x760 840x760 390x844
run cache $S/harness_cache.js $O/demo.html $O/gx.html $O/o_cache
run dcache $S/harness_dcache.js $O/demo.html $O/all.html $O/o_dcache
run dfrom $S/harness_dfrom.js $O/all.html $O/demo.html $O/o_dfrom
run hosted $S/harness_hosted.js $O/hosted.html $O/o_hstd
run setup $S/harness_setup.js $O/setup.html $O/setup-composio.html $O/setup-native.html $O/setup-bare.html $O/setup-xss.html $O/o_setup
run app $S/harness_app.js $O/o_app
run serverpages $S/harness_serverpages.js $O/o_serverpages
echo "suites with failures: $fails"; exit $((fails > 0))
