#!/usr/bin/env bash
# Restore a dump produced by backup_supabase.sh into the CURRENT Supabase
# project — i.e. "someone deleted/overwrote data by mistake, put it back."
#
# This is NOT the script for "the Supabase project itself is gone" — that's
# a rarer, bigger job described in README.md ("Scenario B: rebuilding in a
# new project"), because it also means regenerating logins.
#
# Read README.md's "Restoring" section before running this for the first
# time. Whenever possible, restore a single table with the second argument
# rather than the whole schema — it's much harder to make worse.
#
# Usage:
#   ./restore_supabase.sh <path-to-.dump-or-.dump.gpg> [table_name]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/backup.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy backup.env.example and fill it in." >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL not set in backup.env}"

INPUT_FILE="${1:?Usage: restore_supabase.sh <path-to-.dump-or-.dump.gpg> [table_name]}"
TABLE="${2:-}"
DUMP_FILE="$INPUT_FILE"
TMP_DECRYPTED=""

if [[ "$INPUT_FILE" == *.gpg ]]; then
  echo "Decrypting $INPUT_FILE ..."
  TMP_DECRYPTED="$(mktemp)"
  PASSPHRASE="$(security find-generic-password -a "$USER" -s "${GPG_KEYCHAIN_SERVICE:-AdorableMIS-BackupPassphrase}" -w)"
  gpg --batch --yes --passphrase-fd 0 --decrypt --output "$TMP_DECRYPTED" "$INPUT_FILE" <<< "$PASSPHRASE"
  unset PASSPHRASE
  DUMP_FILE="$TMP_DECRYPTED"
fi

cleanup() { [ -n "$TMP_DECRYPTED" ] && rm -f "$TMP_DECRYPTED"; }
trap cleanup EXIT

echo "Dump contents (first 40 lines):"
pg_restore --list "$DUMP_FILE" | head -40
echo "..."
echo

if [ -n "$TABLE" ]; then
  echo "==> Restoring ONLY table '$TABLE' from $INPUT_FILE into the live database."
  read -r -p "Type 'yes' to continue: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 1; }
  pg_restore --dbname="$SUPABASE_DB_URL" --clean --if-exists --no-owner --no-privileges \
    --table="$TABLE" "$DUMP_FILE"
else
  echo "!! This restores the ENTIRE public schema and overwrites current data. !!"
  echo "!! Prefer restoring a single table (second argument) if you can.        !!"
  read -r -p "Type 'yes' to continue anyway: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 1; }
  pg_restore --dbname="$SUPABASE_DB_URL" --clean --if-exists --no-owner --no-privileges "$DUMP_FILE"
fi

echo "==> Restore complete. Spot-check the app before telling anyone it's fixed."
