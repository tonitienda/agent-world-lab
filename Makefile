.DEFAULT_GOAL := help

AGENT_ID ?= emergent-001
SESSION ?= episode-001
MCP_NAME ?= agent-world

SESSION_DIR := $(CURDIR)/production/$(SESSION)
RECORD_MP4 ?= $(SESSION_DIR)/agent-pov.mp4
OUTPUT ?= production/output/$(SESSION).mp4

.PHONY: help reset set-mcp extract prepare generate preview \
        check status stop-minecraft

help:
	@echo "Emergent — Agent World Lab"
	@echo ""
	@echo "  make cli                    Build the Go episode orchestrator"
	@echo "  make cli-test               Run Go tests with race detection"
	@echo "  make reset                  Reset Minecraft world"
	@echo "  make set-mcp                Configure Claude Code MCP"
	@echo "  make extract                Extract edit plan and narration"
	@echo "  make prepare                Install Motion Canvas dependencies"
	@echo "  make preview                Open Motion Canvas editor"
	@echo "  make generate               Render the episode MP4"
	@echo "  make check                  Run project checks"
	@echo "  make status                 Show Minecraft server status"
	@echo "  make stop-minecraft         Stop Minecraft server"
	@echo ""
	@echo "Variables:"
	@echo "  AGENT_ID=$(AGENT_ID)"
	@echo "  SESSION=$(SESSION)"
	@echo "  RECORD_MP4=$(RECORD_MP4)"
	@echo "  OUTPUT=$(OUTPUT)"

# ------------------------------------------------------------
# 1. Reset the Minecraft environment
# ------------------------------------------------------------

reset:
	npm run world:reset -- --yes
	claude mcp remove agent-world -s local


status:
	docker compose ps

stop-minecraft:
	docker compose down

# ------------------------------------------------------------
# 2. Configure the agent
# ------------------------------------------------------------

set-mcp:
	@mkdir -p "$(SESSION_DIR)"
	@echo "Configuring Claude MCP for $(AGENT_ID)"
	@echo "Recording: $(RECORD_MP4)"
	@claude mcp remove "$(MCP_NAME)" >/dev/null 2>&1 || true
	claude mcp add --transport stdio "$(MCP_NAME)" \
		-e WORLD_ADAPTER=minecraft \
		-e AGENT_ID="$(AGENT_ID)" \
		-e RECORD_MP4="$(RECORD_MP4)" \
		$(if $(SCENARIO_FILE),-e SCENARIO_FILE="$(SCENARIO_FILE)",) \
		-- npm --silent --prefix "$(CURDIR)" run mcp
	@echo ""
	@echo "MCP configured. New Claude processes will use it; restart any existing interactive session."

# ------------------------------------------------------------
# 3. Extract episode data
# ------------------------------------------------------------

extract:
	@test -f "$(SESSION_DIR)/events.json" || \
		(echo "Missing events.json for $(SESSION)" && exit 1)
	@test -f "$(SESSION_DIR)/agent-pov.mp4" || \
		(echo "Missing agent-pov.mp4" && exit 1)
	@test -f "$(SESSION_DIR)/observer.mp4" || \
		(echo "Missing observer.mp4" && exit 1)
	npm run episode:plan -- "$(SESSION_DIR)" "$(SESSION)" --force
	@echo ""
	@echo "Generated:"
	@echo "  production/$(SESSION)/narration.txt"
	@echo "  production/$(SESSION)/narration-manifest.json"
	@echo "  production/$(SESSION)/edit-plan.json"
	@echo ""
	@echo "Generate ElevenLabs clips from narration.txt."
	@echo "Save as 1_Chapter_1.wav, 2_Chapter_1.wav, etc. in:"
	@echo "  production/public/$(SESSION)/audio/"

# ------------------------------------------------------------
# 4. Prepare and preview Motion Canvas
# ------------------------------------------------------------

prepare:
	cd production && npm install

preview:
	cd production && EPISODE_ID="$(SESSION)" npm run dev

# ------------------------------------------------------------
# 5. Generate the final video
# ------------------------------------------------------------

generate:
	@mkdir -p "$(dir $(OUTPUT))"
	EPISODE_ID="$(SESSION)" EPISODE_MUSIC="$(MUSIC)" \
		npm run episode:render-simple -- "$(OUTPUT)"
	@echo ""
	@echo "Generated: $(OUTPUT)"

# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------

check:
	npm run check
	npm test
	cd production && npm run check

# Go orchestration CLI (does not change Minecraft or existing episodes).
.PHONY: cli cli-test
cli:
	go build -o bin/emergence ./cmd/emergence

cli-test:
	go test -race ./...
