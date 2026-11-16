#!/usr/bin/env bash
# Start a throwaway Dovecot on 127.0.0.1 as the current (non-root) user.
# Usage: dovecot-up.sh <dir> <port> <full|minimal|dotted>
#   full    every extension, RFC 6154 special-use folders
#   minimal no extensions, iCloud-style folder names ("Sent Messages", "Deleted Messages")
#   dotted  cPanel/Courier style: "INBOX." prefix, "." separator, no MOVE or CONDSTORE
# Stop with: kill "$(cat <dir>/run/master.pid)"
set -euo pipefail
D="$1"; PORT="$2"; FLAVOR="$3"
SEP=/; PREFIX=; [ "$FLAVOR" = dotted ] && { SEP=.; PREFIX=INBOX.; }
mkdir -p "$D/run" "$D/state" "$D/home"
U="$(id -un)"; G="$(id -gn)"; UIDN="$(id -u)"; GIDN="$(id -g)"
[ -f "$D/cert.pem" ] || openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" -keyout "$D/key.pem" -out "$D/cert.pem" >/dev/null 2>&1
printf 'owner@example.test:{PLAIN}app-password-1\n' > "$D/users"
if [ "$FLAVOR" = full ]; then
  MBOX=""
  for pair in 'Drafts:\Drafts' 'Sent:\Sent' 'Trash:\Trash' 'Junk:\Junk' 'Archive:\Archive'; do
    MBOX+=$'  mailbox '"${pair%%:*}"$' {\n    special_use = '"${pair#*:}"$'\n    auto = subscribe\n  }\n'
  done
  CAPS=''
elif [ "$FLAVOR" = dotted ]; then
  MBOX=""
  for name in 'Drafts' 'Sent' 'Trash' 'Spam'; do
    MBOX+=$'  mailbox '"$name"$' {\n    auto = subscribe\n  }\n'
  done
  CAPS='imap_capability = IMAP4rev1 LITERAL+ SASL-IR LOGIN-REFERRALS ID ENABLE IDLE NAMESPACE UIDPLUS AUTH=PLAIN'
else
  MBOX=""
  for name in 'Drafts' '"Sent Messages"' '"Deleted Messages"' 'Junk'; do
    MBOX+=$'  mailbox '"$name"$' {\n    auto = subscribe\n  }\n'
  done
  CAPS='imap_capability = IMAP4rev1 LITERAL+ SASL-IR LOGIN-REFERRALS ID ENABLE AUTH=PLAIN'
fi
cat > "$D/dovecot.conf" <<CONF
base_dir = $D/run
state_dir = $D/state
log_path = $D/dovecot.log
protocols = imap
listen = 127.0.0.1
default_internal_user = $U
default_internal_group = $G
default_login_user = $U
ssl = required
ssl_cert = <$D/cert.pem
ssl_key = <$D/key.pem
auth_mechanisms = plain login
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u $D/users
}
userdb {
  driver = static
  args = uid=$UIDN gid=$GIDN home=$D/home/%u
}
mail_location = maildir:~/Maildir
namespace inbox {
  inbox = yes
  separator = $SEP
  prefix = $PREFIX
$MBOX}
$CAPS
service imap-login {
  inet_listener imap {
    port = 0
  }
  inet_listener imaps {
    port = $PORT
    ssl = yes
  }
  chroot =
}
service anvil {
  chroot =
}
service stats {
  unix_listener stats-reader {
    mode = 0600
  }
  unix_listener stats-writer {
    mode = 0600
  }
}
CONF
dovecot -c "$D/dovecot.conf"
for i in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/$PORT) 2>/dev/null && { echo "dovecot $FLAVOR up on $PORT"; exit 0; }; sleep 0.2; done
echo "dovecot did not start"; tail -20 "$D/dovecot.log"; exit 1
