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
SESSION_NAME="cybercode-rewind-complex-e2e-${RUN_ID}"
ARTIFACT_DIR="$(mktemp -d "/tmp/cybercode-rewind-complex-e2e-${RUN_ID}-XXXX")"
PROJECT_DIR="${ARTIFACT_DIR}/project"
SERVER_LOG="${ARTIFACT_DIR}/server.log"
WEB_LOG="${ARTIFACT_DIR}/web.log"

mkdir -p "${PROJECT_DIR}/src"
cat > "${PROJECT_DIR}/src/app.js" <<'EOF'
export const STEP = 'base'

export function readStep() {
  return STEP
}
EOF
cat > "${PROJECT_DIR}/README.md" <<'EOF'
# Complex Rewind E2E Fixture

Initial README content.
EOF
cat > "${PROJECT_DIR}/package.json" <<'EOF'
{
  "name": "complex-rewind-e2e-fixture",
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

try_agent_browser() {
  local pid
  (agent-browser --session "${SESSION_NAME}" "$@" >/dev/null 2>&1) &
  pid=$!
  for _ in $(seq 1 5); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
  done
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

try_allow_buttons() {
  try_agent_browser find role button click --name "Allow"
  try_agent_browser find role button click --name "Allow for session"
}

wait_for_file_contains() {
  local file="$1"
  local expected="$2"
  local timeout="${3:-180}"
  for _ in $(seq 1 "$timeout"); do
    if [[ -f "$file" ]] && grep -q "$expected" "$file"; then
      return 0
    fi
    try_allow_buttons
    sleep 2
  done
  echo "Timed out waiting for ${file} to contain ${expected}" >&2
  return 1
}

wait_for_http "${BASE_URL}/health"
wait_for_http "http://127.0.0.1:${WEB_PORT}"

SESSION_ID="$(curl -fsS -X POST "${BASE_URL}/api/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"workDir\":\"${PROJECT_DIR//\"/\\\"}\"}" \
  | bun -e 'const input = await Bun.stdin.text(); const data = JSON.parse(input); console.log(data.sessionId);')"

UNIQUE_TITLE="Complex Rewind ${RUN_ID}"
curl -fsS -X PATCH "${BASE_URL}/api/sessions/${SESSION_ID}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${UNIQUE_TITLE//\"/\\\"}\"}" >/dev/null

APP_FILE="${PROJECT_DIR}/src/app.js"
README_FILE="${PROJECT_DIR}/README.md"
GENERATED_FILE="${PROJECT_DIR}/src/generated.js"
FIRST_PROMPT="Edit src/app.js and replace STEP = 'base' with STEP = 'turn-one'. Do not modify any other file. Reply with DONE when finished."
SECOND_PROMPT="Make exactly these three changes: 1. In src/app.js replace STEP = 'turn-one' with STEP = 'turn-two'. 2. Append a new line to README.md that says Second turn touched README. 3. Create src/generated.js with exactly: export const GENERATED = 'second-turn'. Reply with DONE when finished."

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

${AB} fill 'textarea' "${FIRST_PROMPT}"
${AB} find role button click --name "Run"
wait_for_file_contains "${APP_FILE}" "turn-one" 180
if grep -q "turn-two" "${APP_FILE}" || grep -q "Second turn touched README" "${README_FILE}" || [[ -e "${GENERATED_FILE}" ]]; then
  echo "Unexpected second-turn state after first prompt" >&2
  exit 1
fi
${AB} screenshot "${ARTIFACT_DIR}/03-after-first-turn.png" >/dev/null

${AB} fill 'textarea' "${SECOND_PROMPT}"
${AB} find role button click --name "Run"
wait_for_file_contains "${APP_FILE}" "turn-two" 180
wait_for_file_contains "${README_FILE}" "Second turn touched README" 60
wait_for_file_contains "${GENERATED_FILE}" "second-turn" 60
${AB} screenshot "${ARTIFACT_DIR}/04-after-second-turn.png" >/dev/null

${AB} eval "const buttons = [...document.querySelectorAll('button')].filter((node) => node.getAttribute('aria-label') === 'Rewind to here'); if (buttons.length < 2) throw new Error('Expected at least two Rewind buttons, found ' + buttons.length); buttons[buttons.length - 1].click();"
${AB} wait 1500
${AB} screenshot "${ARTIFACT_DIR}/05-rewind-second-turn-modal.png" >/dev/null
${AB} find role button click --name "Rewind here"

for _ in $(seq 1 120); do
  if grep -q "turn-one" "${APP_FILE}" \
    && ! grep -q "turn-two" "${APP_FILE}" \
    && ! grep -q "Second turn touched README" "${README_FILE}" \
    && [[ ! -e "${GENERATED_FILE}" ]]; then
    break
  fi
  sleep 1
done

if ! grep -q "turn-one" "${APP_FILE}" || grep -q "turn-two" "${APP_FILE}"; then
  echo "src/app.js was not restored to first-turn state" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-app-restore.png" >/dev/null || true
  exit 1
fi
if grep -q "Second turn touched README" "${README_FILE}"; then
  echo "README.md still contains second-turn edit" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-readme-restore.png" >/dev/null || true
  exit 1
fi
if [[ -e "${GENERATED_FILE}" ]]; then
  echo "Generated file still exists after rewinding second turn" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-generated-file.png" >/dev/null || true
  exit 1
fi

${AB} wait 1000
PREFILL_VALUE="$(${AB} get value 'textarea' | tr -d '\r')"
if [[ "${PREFILL_VALUE}" != "${SECOND_PROMPT}" ]]; then
  echo "Composer prefill mismatch after second-turn rewind" >&2
  echo "Expected: ${SECOND_PROMPT}" >&2
  echo "Actual:   ${PREFILL_VALUE}" >&2
  ${AB} screenshot "${ARTIFACT_DIR}/failure-prefill.png" >/dev/null || true
  exit 1
fi

TRANSCRIPT_CHECK="$(curl -fsS "${BASE_URL}/api/sessions/${SESSION_ID}/messages" \
  | FIRST_PROMPT="${FIRST_PROMPT}" SECOND_PROMPT="${SECOND_PROMPT}" bun -e '
const input = await Bun.stdin.text()
const data = JSON.parse(input)
const userMessages = data.messages.filter((message) => message.type === "user")
const texts = userMessages
  .map((message) => {
    if (typeof message.content === "string") return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block && block.type === "text")
        .map((block) => block.text || "")
        .join("\n")
    }
    return ""
  })
console.log(JSON.stringify({
  total: data.messages.length,
  userCount: userMessages.length,
  hasFirstPrompt: texts.includes(process.env.FIRST_PROMPT),
  hasSecondPrompt: texts.includes(process.env.SECOND_PROMPT),
}))
')"
TRANSCRIPT_USER_COUNT="$(printf '%s' "${TRANSCRIPT_CHECK}" | bun -e 'const data = JSON.parse(await Bun.stdin.text()); console.log(data.userCount)')"
TRANSCRIPT_HAS_FIRST="$(printf '%s' "${TRANSCRIPT_CHECK}" | bun -e 'const data = JSON.parse(await Bun.stdin.text()); console.log(data.hasFirstPrompt ? "1" : "0")')"
TRANSCRIPT_HAS_SECOND="$(printf '%s' "${TRANSCRIPT_CHECK}" | bun -e 'const data = JSON.parse(await Bun.stdin.text()); console.log(data.hasSecondPrompt ? "1" : "0")')"
if [[ "${TRANSCRIPT_USER_COUNT}" != "1" || "${TRANSCRIPT_HAS_FIRST}" != "1" || "${TRANSCRIPT_HAS_SECOND}" != "0" ]]; then
  echo "Expected rewound session to keep only the first user prompt, got ${TRANSCRIPT_CHECK}" >&2
  exit 1
fi

${AB} screenshot "${ARTIFACT_DIR}/06-after-second-turn-rewind.png" >/dev/null

echo "Complex rewind E2E passed"
echo "API port: ${API_PORT}"
echo "Web port: ${WEB_PORT}"
