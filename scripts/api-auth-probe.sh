#!/usr/bin/env bash
# Unauthenticated API exposure probe.
#
# Written 2026-07-27 alongside the auth hardening it verifies. Run it against a
# host with NO credentials: every endpoint listed here must refuse. A 200 is a
# failure — it means that endpoint answers the open internet.
#
#   ./scripts/api-auth-probe.sh https://dashboard-staging.4molding.com
#   ./scripts/api-auth-probe.sh https://dashboard.4molding.com
#
# The SPOOF section is the important one: it replays the actual defect that was
# live in production until 2026-07-27 — Pallet Records and Quality identified
# the caller from a self-declared `x-user-id` header, so any known user UUID was
# a login. That UUID is a real enrolled user id; it is not a secret and grants
# nothing once the header is no longer trusted. Keep it here so a regression is
# caught by a failing test rather than by someone else finding it.
#
# GET only, on purpose: this probe must be safe to run against production, so it
# never exercises a handler that writes.

set -uo pipefail
BASE="${1:-https://dashboard.4molding.com}"
SPOOF_UUID="${SPOOF_UUID:-8c1aad5f-3db6-428c-b74f-c1e7c31d10c4}"

FAIL=0

check() { # path, extra curl args...
  local path="$1"; shift
  local code size out
  out=$(curl -s -m 30 -o /dev/null -w "%{http_code} %{size_download}" "$@" "$BASE$path")
  code="${out%% *}"; size="${out##* }"
  # Only 401/403 counts as a pass. Two ways this used to lie (both raised in
  # the 2026-07-27 review panel):
  #   - treating only 200 as failure let a 204 through as "refused";
  #   - treating everything non-200 as a pass meant a 400 (missing query
  #     param), a 500, or a DNS failure all reported "ok" — so a regressed
  #     auth check could hide behind a validation error. Those now report
  #     INCONC and count as failures, because an inconclusive probe is not
  #     evidence of anything.
  case "$code" in
    401|403) printf '  ok     %-42s %s\n' "$path" "$code" ;;
    2*)      printf '  FAIL   %-42s %s (%s bytes)\n' "$path" "$code" "$size"
             FAIL=$((FAIL + 1)) ;;
    *)       printf '  INCONC %-42s %s — not a refusal; check by hand\n' "$path" "$code"
             FAIL=$((FAIL + 1)) ;;
  esac
}

echo "== anonymous reads (expect 401/403) — $BASE =="
for p in \
  /api/pallet-records \
  /api/shipping-records \
  /api/labels \
  /api/labels/activity \
  /api/labels/settings \
  /api/scheduling/entries \
  /api/scheduling/employees \
  /api/scheduling/machines \
  /api/scheduling/audit \
  /api/admin/permissions \
  /api/notifications/my \
  /api/notification-rules \
  /api/orders/assign \
  "/api/pallet-records/00000000-0000-0000-0000-000000000000/audit" \
  "/api/labels/00000000-0000-0000-0000-000000000000"
do check "$p"; done
# ^ that last one is a PARAMETERISED route. It is here because a URL sweep
#   cannot see routes that need an id, which is exactly how it stayed open
#   through the first audit. The id does not have to exist — the auth gate
#   runs before the lookup, so a correct build answers 401 either way.

echo
echo "== spoofed x-user-id (expect 401/403 — the escalation hole) =="
for p in \
  /api/pallet-records/users \
  "/api/pallet-records/pallets/counts?line_numbers=1" \
  /api/quality/products \
  /api/quality/users \
  /api/quality/limits
do check "$p" -H "x-user-id: $SPOOF_UUID"; done

echo
echo "== control: endpoints that MUST stay open =="
# /api/devices/me is how an unpaired floor device asks whether it has been
# approved — it has no credential to present yet and returns only a status.
for p in /api/devices/me; do
  code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "$BASE$p")
  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    printf '  ok    %-42s %s (open by design)\n' "$p" "$code"
  else
    printf '  FAIL  %-42s %s — should be reachable without credentials\n' "$p" "$code"
    FAIL=$((FAIL + 1))
  fi
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "PASS — nothing exposed"
else
  echo "FAIL — $FAIL endpoint(s) wrong"
fi
exit "$FAIL"
