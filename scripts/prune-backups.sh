#!/usr/bin/env bash
# Deletes backups older than RETENTION_DAYS from the db-backups Storage
# bucket. Run nightly, after a fresh backup has already been uploaded, so a
# failed upload never leaves the bucket empty. Requires PROJECT_URL and
# SERVICE_ROLE_KEY in the environment.
#
# Uses -w to capture the HTTP status separately from the body (rather than
# --fail-with-body) so a non-2xx response gets its body printed before
# exiting — the first version used --fail-with-body under `set -e`, which
# aborted before the error body (e.g. "prefix is required") ever reached
# the logs.
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-14}"
BUCKET="db-backups"
cutoff_epoch=$(date -u -d "-${RETENTION_DAYS} days" +%s)

list_response=$(curl -sS -w '\n%{http_code}' -X POST \
  "$PROJECT_URL/storage/v1/object/list/$BUCKET" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "limit": 1000, "sortBy": {"column": "created_at", "order": "asc"}}')
list_status=$(echo "$list_response" | tail -n1)
objects=$(echo "$list_response" | sed '$d')

if [ "$list_status" != "200" ]; then
  echo "Failed to list backups (HTTP $list_status): $objects" >&2
  exit 1
fi

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
  del_response=$(curl -sS -w '\n%{http_code}' -X DELETE \
    "$PROJECT_URL/storage/v1/object/$BUCKET" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefixes\": [\"$name\"]}")
  del_status=$(echo "$del_response" | tail -n1)
  if [ "$del_status" != "200" ]; then
    echo "Failed to delete $name (HTTP $del_status): $(echo "$del_response" | sed '$d')" >&2
    exit 1
  fi
done
