#!/usr/bin/env bash
# Enforces the retention schedule in docs/BACKUP_POLICY.md against the
# db-backups Storage bucket. Run nightly, after a fresh backup has already
# been uploaded, so a failed upload never leaves the bucket empty. Requires
# PROJECT_URL and SERVICE_ROLE_KEY in the environment.
#
# WHY TIERS RATHER THAN A FLAT WINDOW: this script used to keep everything for
# 14 days and delete the rest. That covers the failure you notice immediately —
# a bad import, a dropped table — but not the one schools actually get bitten
# by, where a data error committed in September is only spotted when reports
# are pulled in December. By then every backup predating the error is gone, and
# the corruption is in all of them. Keeping weekly and monthly copies costs a
# few MB and buys a year of "go back to before this was wrong".
#
#   DAILY_DAYS     keep every backup for this many days           (default 14)
#   WEEKLY_WEEKS   then keep Sunday's for this many weeks         (default 8)
#   MONTHLY_MONTHS then keep the 1st of the month for this long   (default 12)
#
# Anything matching none of those tiers is deleted. A backup is dated from the
# timestamp in its filename (backup-YYYY-MM-DDThh-mm-ssZ.tar.gz), not from its
# upload time, so a late-running job is still filed under the day it covers.
#
# Uses -w to capture the HTTP status separately from the body (rather than
# --fail-with-body) so a non-2xx response gets its body printed before
# exiting — the first version used --fail-with-body under `set -e`, which
# aborted before the error body (e.g. "prefix is required") ever reached
# the logs.
set -euo pipefail

DAILY_DAYS="${DAILY_DAYS:-14}"
WEEKLY_WEEKS="${WEEKLY_WEEKS:-8}"
MONTHLY_MONTHS="${MONTHLY_MONTHS:-12}"
BUCKET="db-backups"

daily_cutoff=$(date -u -d "-${DAILY_DAYS} days" +%s)
weekly_cutoff=$(date -u -d "-${WEEKLY_WEEKS} weeks" +%s)
monthly_cutoff=$(date -u -d "-${MONTHLY_MONTHS} months" +%s)

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

names=$(echo "$objects" | jq -r '.[].name')

# Decide each backup's fate from its own filename date. Anything that doesn't
# parse is KEPT, not deleted: an unrecognised name is a reason to look, never
# a reason for a script to throw away a backup.
to_delete=""
kept_daily=0; kept_weekly=0; kept_monthly=0; kept_unparsed=0; marked=0

while read -r name; do
  [ -z "$name" ] && continue

  stamp=$(echo "$name" | sed -n 's/^backup-\([0-9-]\{10\}\)T\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)Z\.tar\.gz$/\1 \2:\3:\4/p')
  if [ -z "$stamp" ]; then
    echo "Keeping (unrecognised name, not touching it): $name"
    kept_unparsed=$((kept_unparsed + 1))
    continue
  fi

  epoch=$(date -u -d "$stamp UTC" +%s 2>/dev/null || true)
  if [ -z "$epoch" ]; then
    echo "Keeping (undateable name, not touching it): $name"
    kept_unparsed=$((kept_unparsed + 1))
    continue
  fi

  dow=$(date -u -d "@$epoch" +%u)   # 7 = Sunday
  dom=$(date -u -d "@$epoch" +%d)

  if [ "$epoch" -ge "$daily_cutoff" ]; then
    kept_daily=$((kept_daily + 1))
  elif [ "$dow" = "7" ] && [ "$epoch" -ge "$weekly_cutoff" ]; then
    kept_weekly=$((kept_weekly + 1))
  elif [ "$dom" = "01" ] && [ "$epoch" -ge "$monthly_cutoff" ]; then
    kept_monthly=$((kept_monthly + 1))
  else
    to_delete="${to_delete}${name}"$'\n'
    marked=$((marked + 1))
  fi
done <<< "$names"

echo "Retention: ${kept_daily} daily, ${kept_weekly} weekly, ${kept_monthly} monthly, ${kept_unparsed} unrecognised; ${marked} to delete."

# A tiered policy that deletes everything is a bug in the policy, not a clean
# bucket. Refuse rather than carry it out.
total_kept=$((kept_daily + kept_weekly + kept_monthly + kept_unparsed))
if [ "$total_kept" -eq 0 ] && [ "$marked" -gt 0 ]; then
  echo "Refusing to delete all ${marked} backups — retention settings look wrong." >&2
  exit 1
fi

if [ -z "${to_delete//[$'\n']/}" ]; then
  echo "Nothing to prune."
  exit 0
fi

echo "$to_delete" | while read -r name; do
  [ -z "$name" ] && continue
  echo "Deleting: $name"
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
