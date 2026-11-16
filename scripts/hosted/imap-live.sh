#!/usr/bin/env bash
# Start full, minimal, and dotted Dovecot, run the live IMAP suite against each, then stop them.
# A missing dovecot binary is a failed check. Do not install packages from here.
set -euo pipefail

if ! command -v dovecot >/dev/null 2>&1; then
  echo "dovecot is not installed"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UP="$ROOT/scripts/hosted/dovecot-up.sh"
cd "$ROOT/server"
node scripts/build-app.mjs

free_port() {
  node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{ console.log(server.address().port); server.close(); });'
}

stop_dir() {
  local dir="$1"
  local pidfile="$dir/run/master.pid"
  local pid=""
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
  fi
  if [[ -n "$pid" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      [[ -f "$pidfile" ]] || break
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.2
    done
  fi
  rm -rf "$dir"
}

current=""
trap '[[ -n "${current}" ]] && stop_dir "$current" || true' EXIT

status=0
for flavor in full minimal dotted; do
  dir="$(mktemp -d "${TMPDIR:-/tmp}/cbm-imap-live.XXXXXX")"
  current="$dir"
  port="$(free_port)"
  "$UP" "$dir" "$port" "$flavor"
  set +e
  CBM_IMAP_LIVE_DIR="$dir" \
  CBM_IMAP_LIVE_PORT="$port" \
  CBM_IMAP_LIVE_FLAVOR="$flavor" \
    ./node_modules/.bin/vitest run --config vitest.live.config.ts
  code=$?
  set -e
  stop_dir "$dir"
  current=""
  if [[ "$code" -ne 0 ]]; then
    status="$code"
  fi
done

exit "$status"
