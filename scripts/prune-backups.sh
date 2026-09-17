#!/usr/bin/env bash
# Deletes backups older than RETENTION_DAYS from the db-backups Storage
# bucket. Run nightly, after a fresh backup has already been uploaded, so a
# failed upload never leaves the bucket empty. Requires PROJECT_URL and
# SERVICE_ROLE_KEY in the environment.
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-14}"
BUCKET="db-backups"
cutoff_epoch=$(date -u -d "-${RETENTION_DAYS} days" +%s)

objects=$(curl --fail-with-body -sS -X POST \
  "$PROJECT_URL/storage/v1/object/list/$BUCKET" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 1000, "sortBy": {"column": "created_at", "order": "asc"}}')

to_delete=$(echo "$objects" | jq -r --argjson cutoff "$cutoff_epoch" '
  .[] | select((.created_at | fromdateiso8601) < $cutoff) | .name
')

if [ -z "$to_delete" ]; then
  echo "No backups older than ${RETENTION_DAYS} days."
  exit 0
fi

echo "$to_delete" | while read -r name; do
  [ -z "$name" ] && continue
  echo "Deleting old backup: $name"
  curl --fail-with-body -sS -X DELETE \
    "$PROJECT_URL/storage/v1/object/$BUCKET" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefixes\": [\"$name\"]}" > /dev/null
done
