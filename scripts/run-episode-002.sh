#!/usr/bin/env bash
set -euo pipefail

EPISODE="episode-002"
AGENT_ID="emergent-002"
SEED="20261027"

# Minecraft spawn/chunks and three Chromium viewers initialize before MCP tools
# become available. Claude's 30-second default can terminate that startup midway.
export MCP_TIMEOUT="${MCP_TIMEOUT:-180000}"
export CLAUDE_CODE_MCP_STARTUP_WAIT_MS="${CLAUDE_CODE_MCP_STARTUP_WAIT_MS:-$MCP_TIMEOUT}"
for timeout in "$MCP_TIMEOUT" "$CLAUDE_CODE_MCP_STARTUP_WAIT_MS"; do
  if [[ ! "$timeout" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: MCP startup timeouts must be positive milliseconds"
    exit 1
  fi
done

PROMPT="production/${EPISODE}/prompt.txt"
SESSION_DIR="production/${EPISODE}"

cd "$(dirname "$0")/.."

if [[ ! -s "$PROMPT" ]]; then
  echo "ERROR: Missing or empty prompt: $PROMPT"
  exit 1
fi

echo "=== 1. Reset survival world ==="

EULA=TRUE npm run world:reset -- \
  --yes \
  --preset survival \
  --seed "$SEED"

echo "=== 2. Survival preflight ==="

npm run world:preflight -- --profile survival

echo "=== 3. Prepare and verify ravine course ==="
npm run scenario:ravine -- --yes --agent "$AGENT_ID"
# Reconnect as the recording player to verify that the prepared position persisted.
npm run scenario:ravine -- --verify-only --agent "$AGENT_ID"
SCENARIO_BRIEFING=$(npm --silent run scenario:ravine -- --briefing --agent "$AGENT_ID")

# This runner replaces the current take. Keep the prompt and production source
# files in place, but remove old capture artifacts from the MCP destination:
# SessionEvents intentionally refuses to start in a folder containing old captures.
shopt -s nullglob
capture_files=(
  "$SESSION_DIR/events.json"
  "$SESSION_DIR/events.json.tmp"
  "$SESSION_DIR/metadata.json"
  "$SESSION_DIR/mcp-session.json"
  "$SESSION_DIR/scenario.json"
  "$SESSION_DIR/"*.mp4
  "$SESSION_DIR/"*.webm
  "$SESSION_DIR/"*-debug.png
)
existing_captures=()
for file in "${capture_files[@]}"; do
  [[ ! -f "$file" ]] || existing_captures+=("$file")
done
if (( ${#existing_captures[@]} )); then
  archive=$(mktemp -d "production/${EPISODE}-previous-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  echo "Archiving previous capture artifacts: $archive"
  mv -- "${existing_captures[@]}" "$archive/"
fi

echo "=== 4. Configure MCP ==="

make set-mcp \
  SESSION="$EPISODE" \
  AGENT_ID="$AGENT_ID" \
  SCENARIO_FILE="$(pwd)/data/minecraft/scenario.json"

echo "=== 5. Run Claude ==="
echo "Waiting up to ${MCP_TIMEOUT} ms for Minecraft and all three cameras."

# The MCP must remain available to Claude for
# the entire duration of this command.
#
# The prompt must instruct Claude to call
# finish_session even when the task fails.

claude -p "$(cat "$PROMPT")"$'\n\n'"$SCENARIO_BRIEFING"

echo "=== 6. Verify recording ==="

for file in \
  events.json \
  mcp-session.json \
  agent-pov.mp4 \
  observer.mp4 \
  follow.mp4
do
  if [[ ! -s "$SESSION_DIR/$file" ]]; then
    echo "ERROR: Missing or empty $file"
    echo "Do not reset Minecraft until the"
    echo "recording session is safely finalized."
    exit 1
  fi
done

echo "=== Episode recorded successfully ==="
echo "Session: $SESSION_DIR"
echo ""
echo "Next: inspect the recording, then run:"
echo "make extract SESSION=$EPISODE"
