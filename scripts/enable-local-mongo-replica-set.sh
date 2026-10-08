#!/usr/bin/env bash
# Inventory writers that use multi-document transactions need MongoDB transactions:
#   physical count, POS sale/return, purchase-order receive, and related paths.
# Transactions require a replica set — a standalone mongod will fail with:
#   Transaction numbers are only allowed on a replica set member or mongos
#
# This is an environment requirement for local/dev live runs (and any live
# integration tests against real Mongo). Isolated unit tests that mock sessions
# do not need a replica set.
#
# This script converts the Homebrew mongodb-community@8.0 instance into a
# single-node replica set (rs0) and initiates it. Safe for local dev.
set -euo pipefail

CONF="${MONGOD_CONF:-/opt/homebrew/etc/mongod.conf}"
PLIST="${HOME}/Library/LaunchAgents/homebrew.mxcl.mongodb-community@8.0.plist"
LABEL="homebrew.mxcl.mongodb-community@8.0"
HOST="${MONGO_RS_HOST:-127.0.0.1:27017}"

if [[ ! -f "$CONF" ]]; then
  echo "mongod.conf not found at $CONF"
  exit 1
fi

if ! grep -q 'replSetName' "$CONF"; then
  printf '\nreplication:\n  replSetName: rs0\n' >> "$CONF"
  echo "Added replication.replSetName=rs0 to $CONF"
else
  echo "replSetName already present in $CONF"
fi

if [[ -f "$PLIST" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Restarted $LABEL"
else
  echo "LaunchAgent not found at $PLIST — restart mongod yourself, then re-run this script."
  exit 1
fi

echo "Waiting for mongod..."
for _ in $(seq 1 30); do
  if mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 1
done

mongosh --quiet --eval "
try {
  const s = rs.status();
  print('Replica set already up: ' + s.set + ' (state ' + s.myState + ')');
} catch (e) {
  print('Initiating rs0...');
  printjson(rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '${HOST}' }] }));
}
"

sleep 3
mongosh --quiet --eval 'const s = rs.status(); printjson({ set: s.set, myState: s.myState, ok: s.ok })'
echo "Done. Retry physical count in the admin UI (restart the backend if it was mid-request)."
