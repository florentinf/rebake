#!/bin/sh
# Builds, then ships dist/ to furka over Tailscale SSH. Hashed files go first, so
# no visitor ever gets HTML that points at assets that aren't there yet.
#   npm run deploy            # site files
#   npm run deploy -- --caddy # site files plus the Caddy block
set -eu

HOST=${REBAKE_HOST:-furka}
ROOT=/var/www/rebake
SITE=/etc/caddy/sites/25-rebake.florentinf.dev.caddy

npm run build
export COPYFILE_DISABLE=1

ssh "$HOST" "sudo install -d -o \$(id -un) -g \$(id -gn) -m 755 $ROOT"
rsync -rltp dist/assets dist/engines "$HOST:$ROOT/"
rsync -rltp --exclude assets --exclude engines dist/ "$HOST:$ROOT/"

if [ "${1:-}" = "--caddy" ]; then
  scp -q deploy/rebake.florentinf.dev.caddy "$HOST:/tmp/rebake.caddy"
  ssh "$HOST" "sudo install -m 644 /tmp/rebake.caddy $SITE && rm /tmp/rebake.caddy \
    && sudo sh -c 'set -a; . /etc/caddy/caddy.env; set +a; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile' \
    && sudo systemctl reload caddy"
fi

echo "deployed to https://rebake.florentinf.dev"
