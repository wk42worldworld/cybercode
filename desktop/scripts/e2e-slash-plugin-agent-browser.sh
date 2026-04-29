#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser is required but was not found in PATH" >&2
  exit 1
fi

API_URL="${API_URL:-http://127.0.0.1:3457}"
WEB_URL="${WEB_URL:-http://127.0.0.1:5175/?serverUrl=http://127.0.0.1:3457}"
RUN_ID="$(date +%s)-$RANDOM"
SESSION_NAME="cybercode-webui-e2e-${RUN_ID}"
ARTIFACT_DIR="$(mktemp -d "/tmp/cybercode-webui-e2e-${RUN_ID}-XXXX")"
AB=(agent-browser --session "${SESSION_NAME}")

cleanup() {
  local exit_code=$?
  "${AB[@]}" close >/dev/null 2>&1 || true
  echo "Artifacts kept at: ${ARTIFACT_DIR}" >&2
}
trap cleanup EXIT

wait_for_text() {
  local needle="$1"
  if ! "${AB[@]}" wait "text=${needle}" >/dev/null 2>&1; then
    echo "Timed out waiting for page text: ${needle}" >&2
    "${AB[@]}" screenshot "${ARTIFACT_DIR}/failure-wait-$(echo "${needle}" | tr ' /' '__').png" >/dev/null 2>&1 || true
    return 1
  fi
}

press_escape() {
  "${AB[@]}" press Escape >/dev/null 2>&1 || true
}

focus_composer() {
  "${AB[@]}" click textarea >/dev/null 2>&1 || "${AB[@]}" focus textarea >/dev/null 2>&1 || true
}

submit_slash_command() {
  local command="$1"
  focus_composer
  "${AB[@]}" fill textarea "${command}"
  "${AB[@]}" press Enter
}

healthcheck() {
  curl -fsS "${API_URL}/health" >/dev/null
}

select_plugin_targets() {
  DETAIL_PLUGIN_ID="$(curl -fsS "${API_URL}/api/plugins" | jq -r '
    .plugins
    | map(select((.componentCounts.commands + .componentCounts.agents + .componentCounts.hooks + .componentCounts.skills) > 0))
    | sort_by(-(.componentCounts.commands + .componentCounts.agents + .componentCounts.hooks + .componentCounts.skills))
    | .[0].id // empty
  ')"

  ENABLED_SKILL_PLUGIN_ID="$(curl -fsS "${API_URL}/api/plugins" | jq -r '
    .plugins
    | map(select(.enabled == true and .componentCounts.skills > 0))
    | sort_by(-.componentCounts.skills)
    | .[0].id // empty
  ')"

  MCP_PLUGIN_ID="$(curl -fsS "${API_URL}/api/plugins" | jq -r '
    .plugins
    | map(select(.enabled == true and .componentCounts.mcpServers > 0))
    | sort_by(-.componentCounts.mcpServers)
    | .[0].id // empty
  ')"

  if [[ -z "${DETAIL_PLUGIN_ID}" ]]; then
    echo "No plugin with commands/agents/hooks/skills was found in current API data." >&2
    exit 1
  fi

  if [[ -z "${ENABLED_SKILL_PLUGIN_ID}" ]]; then
    echo "No enabled plugin with skills was found in current API data." >&2
    exit 1
  fi

  if [[ -z "${MCP_PLUGIN_ID}" ]]; then
    echo "No plugin with MCP servers was found in current API data." >&2
    exit 1
  fi

  DETAIL_PLUGIN_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.name')"
  DETAIL_PLUGIN_ENABLED="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.enabled')"
  DETAIL_COMMAND="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.commandEntries[0].name // empty')"
  DETAIL_AGENT="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.agentEntries[0].name // empty')"
  DETAIL_AGENT_LABEL="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.agentEntries[0].displayName // .detail.agentEntries[0].name // empty')"
  DETAIL_HOOK_EVENT="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.hookEntries[0].event // empty')"
  DETAIL_HOOK_ACTION="$(curl -fsS "${API_URL}/api/plugins/detail?id=${DETAIL_PLUGIN_ID}" | jq -r '.detail.hookEntries[0].actions[0] // empty')"
  DETAIL_SKILL_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${ENABLED_SKILL_PLUGIN_ID}" | jq -r '.detail.skillEntries[0].name // empty')"
  DETAIL_SKILL_LABEL="$(curl -fsS "${API_URL}/api/plugins/detail?id=${ENABLED_SKILL_PLUGIN_ID}" | jq -r '.detail.skillEntries[0].displayName // .detail.skillEntries[0].name // empty')"
  DETAIL_SKILL_DESCRIPTION="$(curl -fsS --get --data-urlencode "source=plugin" --data-urlencode "name=${DETAIL_SKILL_NAME}" "${API_URL}/api/skills/detail" | jq -r '.detail.meta.description // empty')"
  DETAIL_SKILL_PLUGIN_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${ENABLED_SKILL_PLUGIN_ID}" | jq -r '.detail.name')"

  MCP_PLUGIN_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${MCP_PLUGIN_ID}" | jq -r '.detail.name')"
  MCP_SERVER_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${MCP_PLUGIN_ID}" | jq -r '.detail.mcpServerEntries[0].name // empty')"
  MCP_SERVER_LABEL="$(curl -fsS "${API_URL}/api/plugins/detail?id=${MCP_PLUGIN_ID}" | jq -r '.detail.mcpServerEntries[0].displayName // .detail.mcpServerEntries[0].name // empty')"
  MCP_SKILL_NAME="$(curl -fsS "${API_URL}/api/plugins/detail?id=${MCP_PLUGIN_ID}" | jq -r '.detail.skillEntries[0].name // empty')"
}

open_plugin_detail() {
  local plugin_name="$1"
  local escaped_name="${plugin_name//\"/\\\"}"
  if "${AB[@]}" eval "const target=[...document.querySelectorAll('button')].find((node)=>node.textContent?.includes(\"${escaped_name}\")); if(!target) throw new Error('plugin button not found'); target.click();" >/dev/null 2>&1; then
    wait_for_text "Bundled capabilities"
    return 0
  fi

  echo "Failed to open plugin detail for: ${plugin_name}" >&2
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/failure-open-plugin-${plugin_name}.png" >/dev/null 2>&1 || true
  return 1
}

go_back_to_plugin_list() {
  "${AB[@]}" eval "const target=[...document.querySelectorAll('button')].find((node)=>node.textContent?.includes('Back to list')); if(!target) throw new Error('back button not found'); target.click();" >/dev/null
  wait_for_text "Browse installed plugins"
}

open_settings_sidebar_tab() {
  local tab_name="$1"
  "${AB[@]}" eval "const target=[...document.querySelectorAll('button')].find((node)=>node.textContent?.trim()==='${tab_name}'); if(!target) throw new Error('settings tab not found: ${tab_name}'); target.click();" >/dev/null
}

click_visible_card_text() {
  local text="$1"
  local escaped_text="${text//\"/\\\"}"
  "${AB[@]}" eval "const target=[...document.querySelectorAll('button')].find((node)=>node.textContent?.includes(\"${escaped_text}\")); if(!target) throw new Error('button not found: ${escaped_text}'); target.click();" >/dev/null
}

healthcheck
select_plugin_targets

echo "Using detail plugin: ${DETAIL_PLUGIN_NAME} (${DETAIL_PLUGIN_ID})"
echo "Using enabled skill plugin: ${DETAIL_SKILL_PLUGIN_NAME} (${ENABLED_SKILL_PLUGIN_ID})"
echo "Using MCP plugin: ${MCP_PLUGIN_NAME} (${MCP_PLUGIN_ID})"

"${AB[@]}" open "${WEB_URL}"
"${AB[@]}" wait --load networkidle
wait_for_text "CyberCode"
"${AB[@]}" screenshot "${ARTIFACT_DIR}/01-home.png" >/dev/null

# Always work from a fresh chat surface so slash-command behavior is deterministic.
"${AB[@]}" find role button click --name "New session"
"${AB[@]}" wait textarea >/dev/null

submit_slash_command "/mcp"
wait_for_text "Available MCP tools"
"${AB[@]}" screenshot "${ARTIFACT_DIR}/02-mcp-panel.png" >/dev/null
press_escape
"${AB[@]}" wait 300 >/dev/null

submit_slash_command "/skills"
wait_for_text "Available skills"
"${AB[@]}" screenshot "${ARTIFACT_DIR}/03-skills-panel.png" >/dev/null
press_escape
"${AB[@]}" wait 300 >/dev/null

submit_slash_command "/plugin"
wait_for_text "Browse installed plugins"
wait_for_text "Plugin Manager"
"${AB[@]}" screenshot "${ARTIFACT_DIR}/04-plugins-list.png" >/dev/null

open_plugin_detail "${DETAIL_PLUGIN_NAME}"
wait_for_text "Commands"
wait_for_text "Agents"
wait_for_text "Hooks"
wait_for_text "Skills"
if [[ -n "${DETAIL_COMMAND}" ]]; then
  wait_for_text "/${DETAIL_COMMAND}"
fi
if [[ -n "${DETAIL_AGENT}" ]]; then
  wait_for_text "${DETAIL_AGENT}"
fi
if [[ -n "${DETAIL_HOOK_EVENT}" ]]; then
  wait_for_text "${DETAIL_HOOK_EVENT}"
fi
if [[ -n "${DETAIL_HOOK_ACTION}" ]]; then
  wait_for_text "${DETAIL_HOOK_ACTION}"
fi
if [[ -n "${DETAIL_SKILL_NAME}" ]]; then
  wait_for_text "/${DETAIL_SKILL_NAME}"
fi
"${AB[@]}" screenshot "${ARTIFACT_DIR}/05-plugin-detail-main.png" >/dev/null

open_settings_sidebar_tab "Plugins"
wait_for_text "Plugin Detail"
go_back_to_plugin_list
open_plugin_detail "${DETAIL_SKILL_PLUGIN_NAME}"

if [[ -n "${DETAIL_SKILL_LABEL}" ]]; then
  click_visible_card_text "${DETAIL_SKILL_LABEL}"
  wait_for_text "Skill metadata"
  wait_for_text "${DETAIL_SKILL_LABEL}"
  if [[ -n "${DETAIL_SKILL_DESCRIPTION}" ]]; then
    wait_for_text "${DETAIL_SKILL_DESCRIPTION}"
  fi
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/06-skill-detail-from-plugin.png" >/dev/null

  open_settings_sidebar_tab "Skills"
  wait_for_text "Skill Browser"
  wait_for_text "Plugin"
  wait_for_text "${DETAIL_SKILL_LABEL}"
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/07-skills-list-with-plugin-group.png" >/dev/null
fi

open_settings_sidebar_tab "Plugins"
wait_for_text "Plugin Detail"

if [[ "${DETAIL_PLUGIN_ENABLED}" == "true" && -n "${DETAIL_AGENT_LABEL}" ]]; then
  click_visible_card_text "${DETAIL_AGENT_LABEL}"
  wait_for_text "Agent Profile"
  wait_for_text "${DETAIL_AGENT}"
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/08-agent-detail-from-plugin.png" >/dev/null

  open_settings_sidebar_tab "Agents"
  wait_for_text "Agent Browser"
  wait_for_text "Plugin"
  wait_for_text "${DETAIL_AGENT}"
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/09-agents-list-with-plugin-group.png" >/dev/null
fi

go_back_to_plugin_list
open_plugin_detail "${MCP_PLUGIN_NAME}"
wait_for_text "MCP servers"
if [[ -n "${MCP_SERVER_NAME}" ]]; then
  wait_for_text "${MCP_SERVER_LABEL:-$MCP_SERVER_NAME}"
fi
if [[ -n "${MCP_SKILL_NAME}" ]]; then
  wait_for_text "/${MCP_SKILL_NAME}"
fi
"${AB[@]}" screenshot "${ARTIFACT_DIR}/10-plugin-detail-mcp.png" >/dev/null

if [[ -n "${MCP_SERVER_LABEL}" ]]; then
  click_visible_card_text "${MCP_SERVER_LABEL}"
  wait_for_text "${MCP_SERVER_NAME}"
  wait_for_text "Plugin"
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/11-mcp-detail-from-plugin.png" >/dev/null

  open_settings_sidebar_tab "MCP"
  wait_for_text "MCP servers"
  wait_for_text "Plugin"
  wait_for_text "${MCP_SERVER_NAME}"
  "${AB[@]}" screenshot "${ARTIFACT_DIR}/12-mcp-list-with-plugin-group.png" >/dev/null
fi

echo "agent-browser web UI regression passed"
echo "Artifacts: ${ARTIFACT_DIR}"
