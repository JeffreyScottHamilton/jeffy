#!/usr/bin/env bash
# Verify the VoiceStudio gateway. Usage: VOICESTUDIO_AUTH_TOKEN=... verify-gateway.sh <base-url>
# Optional: VOICESTUDIO_VOICE_ID (default alloy). The token is never printed.
set -u

BASE="${1:-}"
if [ -z "$BASE" ]; then echo "usage: $0 <base-url>" >&2; exit 2; fi
BASE="${BASE%/}"
if [ -z "${VOICESTUDIO_AUTH_TOKEN:-}" ]; then echo "VOICESTUDIO_AUTH_TOKEN is not set" >&2; exit 2; fi
VOICE="${VOICESTUDIO_VOICE_ID:-alloy}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

# check <name> <expected-code> <expected-type-prefix or ""> -- curl args...
check() {
  local name="$1" want="$2" wantType="$3"; shift 4
  local out code type
  out="$(curl -sS --max-time 150 -o "$TMP/body" -w '%{http_code} %{content_type}' "$@" 2>"$TMP/err")" || out="000 "
  code="${out%% *}"; type="${out#* }"
  if [ "$code" = "$want" ] && { [ -z "$wantType" ] || [[ "$type" == "$wantType"* ]]; }; then
    echo "PASS  $name (HTTP $code)"
  else
    echo "FAIL  $name (expected $want${wantType:+ $wantType*}, got $code $type)"
    fail=1
  fi
}

AUTH=(-H "Authorization: Bearer $VOICESTUDIO_AUTH_TOKEN")
JSON=(-X POST -H 'Content-Type: application/json')
BODY="$(printf '{"input":"Gateway check.","voice":"%s","response_format":"wav"}' "$VOICE")"

check "1 no auth -> 401"             401 "" -- "$BASE/health"
check "2 wrong token -> 401"         401 "" -- -H "Authorization: Bearer wrong-token-value" "$BASE/health"
check "3 valid token /health -> 200" 200 "" -- "${AUTH[@]}" "$BASE/health"
check "4 /profiles blocked -> 404"   404 "" -- "${AUTH[@]}" "$BASE/profiles"
check "5 speech -> 200 audio/*"      200 "audio/" -- "${AUTH[@]}" "${JSON[@]}" -d "$BODY" "$BASE/v1/audio/speech"

if [ "$fail" -eq 0 ]; then echo "All checks passed."; else echo "Some checks FAILED."; fi
exit "$fail"
