#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
if [[ ! "$BASE_URL" =~ ^(http|https)://([^:/]+)(:([0-9]+))?$ ]]; then
  echo "BASE_URL must be an origin such as http://localhost:8080" >&2
  exit 2
fi
scheme="${BASH_REMATCH[1]}"
host="${BASH_REMATCH[2]}"
port="${BASH_REMATCH[4]:-$( [[ "$scheme" == https ]] && echo 443 || echo 80 )}"
if [[ ! "$host" =~ ^(localhost|127\.0\.0\.1)$ && "${ALLOW_REMOTE_LOAD_TESTS:-false}" != true ]]; then
  echo "Remote load testing is disabled. Set ALLOW_REMOTE_LOAD_TESTS=true only for your own deployment." >&2
  exit 2
fi
if [[ -z "${AUTH_TOKEN:-}" ]]; then
  echo "AUTH_TOKEN is required for reservation concurrency. Use a Firebase Auth emulator ID token." >&2
  exit 2
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="tests/performance/results/jmeter-${stamp}"
mkdir -p "$output"
jmeter -n -t tests/performance/jmeter/ticket-maestro.jmx \
  -Jprotocol="$scheme" -Jhost="$host" -Jport="$port" \
  -JAUTH_TOKEN="$AUTH_TOKEN" -JeventId="${EVENT_ID:-load-oversale-event}" \
  -JbrowseUsers="${BROWSE_USERS:-20}" -JbrowseDuration="${BROWSE_DURATION:-60}" \
  -JreserveUsers="${RESERVE_USERS:-500}" -JreserveRamp="${RESERVE_RAMP:-1}" \
  -l "$output/results.jtl" -e -o "$output/html"
echo "JMeter results: $output/results.jtl"
