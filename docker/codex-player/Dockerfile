# Isolated Codex player. The image holds Codex and nothing from this repository:
# no scenario, no solution, no host home. The only game access is the trusted
# agent-world MCP server on the host, reached over token-protected HTTP.
# Build with `make codex-player-image`; the tag must match internal/harness.
FROM node:22-bookworm-slim
ARG CODEX_VERSION=0.167.0
# Codex's HTTPS client trusts the system store, which the slim image lacks.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
 && npm cache clean --force \
 && mkdir /work /codex && chown node:node /work /codex
USER node
WORKDIR /work
ENV CODEX_HOME=/codex
ENTRYPOINT ["codex"]
