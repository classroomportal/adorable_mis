#!/usr/bin/env bash
# Nightly backup of the Adorable MIS Supabase database.
#
# Dumps the `public` schema only (custom format) — that's every school
# table, view, function, trigger and RLS policy in one restorable file.
# auth.users/auth.identities (login credentials) are intentionally NOT
# included; see README.md ("Why auth isn't in the dump") for why that's
# fine, and safer, for this app.
#
# Usage: ./backup_supabase.sh   (run manually, or via launchd — see README.md)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/backup.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy backup.env.example to backup.env and fill it in first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL not set in backup.env}"
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-$HOME/AdorableMIS-Backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DUMP_FILE="$LOCAL_BACKUP_DIR/adorable_mis_${TIMESTAMP}.dump"

mkdir -p "$LOCAL_BACKUP_DIR"
chmod 700 "$LOCAL_BACKUP_DIR"

echo "[$(date)] Dumping public schema from Supabase..."
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="$DUMP_FILE"

echo "[$(date)] Verifying the dump isn't truncated/corrupt..."
pg_restore --list "$DUMP_FILE" > /dev/null

echo "[$(date)] Wrote $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

echo "[$(date)] Pruning local backups older than ${RETENTION_DAYS} days..."
find "$LOCAL_BACKUP_DIR" -name 'adorable_mis_*.dump' -mtime +"$RETENTION_DAYS" -print -delete

# ---- offsite copy (Google Drive) -------------------------------------------
if [ -n "${CLOUD_BACKUP_DIR:-}" ]; then
  mkdir -p "$CLOUD_BACKUP_DIR"

  if [ -n "${GPG_KEYCHAIN_SERVICE:-}" ] && command -v gpg >/dev/null 2>&1; then
    CLOUD_FILE="$CLOUD_BACKUP_DIR/$(basename "$DUMP_FILE").gpg"
    PASSPHRASE="$(security find-generic-password -a "$USER" -s "$GPG_KEYCHAIN_SERVICE" -w)"
    gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 \
      --output "$CLOUD_FILE" "$DUMP_FILE" <<< "$PASSPHRASE"
    unset PASSPHRASE
    echo "[$(date)] Encrypted copy -> $CLOUD_FILE"
  else
    echo "[$(date)] WARNING: GPG_KEYCHAIN_SERVICE not set or gpg missing — copying UNENCRYPTED. See README.md step 3." >&2
    cp "$DUMP_FILE" "$CLOUD_BACKUP_DIR/"
  fi

  find "$CLOUD_BACKUP_DIR" \( -name 'adorable_mis_*.dump' -o -name 'adorable_mis_*.dump.gpg' \) \
    -mtime +"$RETENTION_DAYS" -print -delete
else
  echo "[$(date)] CLOUD_BACKUP_DIR not set — skipping offsite copy. This means you only have ONE copy, on this Mac." >&2
fi

echo "[$(date)] Backup finished."
