#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser is required but was not found in PATH" >&2
  exit 1
fi

PORTS="$(bun -e 'import { createServer } from "node:net"; const getPort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(port)); }); }); const apiPort = await getPort(); const webPort = await getPort(); console.log(`${apiPort} ${webPort}`);')"
API_PORT="${PORTS%% *}"
WEB_PORT="${PORTS##* }"
BASE_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}/?serverUrl=${BASE_URL}"

RUN_ID="$(date +%s)-$RANDOM"
SESSION_NAME="cybercode-rewind-e2e-${RUN_ID}"
ARTIFACT_DIR="$(mktemp -d "/tmp/cybercode-rewind-e2e-${RUN_ID}-XXXX")"
PROJECT_DIR="${ARTIFACT_DIR}/project"
SERVER_LOG="${ARTIFACT_DIR}/server.log"
WEB_LOG="${ARTIFACT_DIR}/web.log"

mkdir -p "${PROJECT_DIR}/src"
cat > "${PROJECT_DIR}/src/app.js" <<'EOF'
export const ORIGINAL_VALUE = 'before-rewind'

export function readValue() {
  return ORIGINAL_VALUE
}
EOF
cat > "${PROJECT_DIR}/README.md" <<'EOF'
# Rewind E2E Fixture

This project is created automatically by the agent-browser rewind E2E script.
EOF
cat > "${PROJECT_DIR}/package.json" <<'EOF'
{
  "name": "rewind-e2e-fixture",
  "private": true,
  "type": "module"
}
EOF

cleanup() {
  local exit_code=$?
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    wait "${WEB_PID}" >/dev/null 2>&1 || true
  fi
  agent-browser --session "${SESSION_NAME}" close >/dev/null 2>&1 || true
  if [[ $exit_code -ne 0 ]]; then
    echo "Artifacts kept at: ${ARTIFACT_DIR}" >&2
  else
    rm -rf "${ARTIFACT_DIR}"
  fi
}
trap cleanup EXIT

echo "Starting backend on ${BASE_URL}"
(
  cd "${ROOT_DIR}"
  SERVER_PORT="${API_PORT}" bun run src/server/index.ts --port "${API_PORT}" --host 127.0.0.1
) >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

echo "Starting web UI on http://127.0.0.1:${WEB_PORT}"
(
  cd "${DESKTOP_DIR}"
  bun run dev -- --host 127.0.0.1 --port "${WEB_PORT}"
) >"${WEB_LOG}" 2>&1 &
WEB_PID=$!

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${url}" >&2
  return 1
}

wait_for_http "${BASE_URL}/health"
wait_for_http "http://127.0.0.1:${WEB_PORT}"

SESSION_ID="$(curl -fsS -X POST "${BASE_URL}/api/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"workDir\":\"${PROJECT_DIR//\"/\\\"}\"}" \
  | bun -e 'const input = await Bun.stdin.text(); const data = JSON.parse(input); console.log(data.sessionId);')"

UNIQUE_TITLE="E2E Rewind ${RUN_ID}"
curl -fsS -X PATCH "${BASE_URL}/api/sessions/${SESSION_ID}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${UNIQUE_TITLE//\"/\\\"}\"}" >/dev/null

PROMPT="Edit src/app.js and replace before-rewind with after-rewind. Do not modify any other file. Reply with DONE when finished."
TARGET_FILE="${PROJECT_DIR}/src/app.js"

AB="agent-browser --session ${SESSION_NAME}"

${AB} open "${WEB_URL}"
${AB} wait 2000
${AB} eval "localStorage.setItem('cybercode-locale', 'en'); location.reload();"
${AB} wait 2000
${AB} screenshot "${ARTIFACT_DIR}/01-home.png" >/dev/null

${AB} fill '#sidebar-search' "${UNIQUE_TITLE}"
${AB} find text "${UNIQUE_TITLE}" click
${AB} wait 1000
${AB} screenshot "${ARTIFACT_DIR}/02-session-open.png" >/dev/null

${AB} fill 'textarea' "${PROMPT}"
${AB} find role button click --name "Run"

for _ in $(seq 1 180); do
  ${AB} find role button click --name "Allow" >/dev/null 2>&1 || true
  ${AB} find role button click --name "Allow for session" >/dev/null 2>&1 || true
  if grep -q "after-rewind" "${TARGET_FILE}"; then
    break
  fi
  sleep 2
done

if ! grep -q "after-rewind" "${TARGET_FILE}"; then
  echo "Timed out waiting for edited file contents" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-edit-timeout.png" >/dev/null || true
  exit 1
fi

${AB} screenshot "${ARTIFACT_DIR}/03-after-edit.png" >/dev/null

${AB} eval "const button = [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === 'Rewind to here'); if (!button) throw new Error('Rewind button not found'); button.click();"
${AB} wait 1500
${AB} screenshot "${ARTIFACT_DIR}/04-rewind-modal.png" >/dev/null
${AB} find role button click --name "Rewind here"

for _ in $(seq 1 120); do
  if grep -q "before-rewind" "${TARGET_FILE}" && ! grep -q "after-rewind" "${TARGET_FILE}"; then
    break
  fi
  sleep 1
done

if ! grep -q "before-rewind" "${TARGET_FILE}" || grep -q "after-rewind" "${TARGET_FILE}"; then
  echo "Timed out waiting for rewind to restore original file contents" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-rewind-timeout.png" >/dev/null || true
  exit 1
fi

${AB} wait 1000
PREFILL_VALUE="$(${AB} get value 'textarea' | tr -d '\r')"
if [[ "${PREFILL_VALUE}" != "${PROMPT}" ]]; then
  echo "Composer prefill mismatch after rewind" >&2
  echo "Expected: ${PROMPT}" >&2
  echo "Actual:   ${PREFILL_VALUE}" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-prefill.png" >/dev/null || true
  exit 1
fi

MESSAGE_COUNT="$(curl -fsS "${BASE_URL}/api/sessions/${SESSION_ID}/messages" \
  | bun -e 'const input = await Bun.stdin.text(); const data = JSON.parse(input); console.log(data.messages.length);')"
if [[ "${MESSAGE_COUNT}" != "0" ]]; then
  echo "Expected rewound session to have 0 transcript messages, got ${MESSAGE_COUNT}" >&2
  exit 1
fi

${AB} screenshot "${ARTIFACT_DIR}/05-after-rewind.png" >/dev/null

echo "Rewind E2E passed"
echo "API port: ${API_PORT}"
echo "Web port: ${WEB_PORT}"
