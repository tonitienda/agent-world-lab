#!/usr/bin/env bash
# Interactive front door; orchestration, parsing and state remain in Go.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Usage: ./pipeline.sh [--design codex|claude] [--player claude] [--take 001] path-to-episode.yaml

Generate/reuse a scenario, explain an automated code review, and ask before
installing it. Open the browser world preview and approve the challenge to start
the recorded take. Supply the named WAVs when prompted, review the measured-audio
Motion Canvas draft, then approve the final render.

Rerun the same command to resume; recordings and completed takes are not replaced.
--dry-run prints the steps without changing episode files or starting services.
Use --take 002 for another recording. There is no blanket --yes option.
HELP
  exit 0
fi
if [[ ! -x "$ROOT/bin/emergence" || "$ROOT/go.mod" -nt "$ROOT/bin/emergence" || "$ROOT/go.sum" -nt "$ROOT/bin/emergence" ]] ||
   [[ -n "$(find "$ROOT/cmd" "$ROOT/internal" -type f -name '*.go' -newer "$ROOT/bin/emergence" -print -quit)" ]]; then
  make -s -C "$ROOT" cli
fi
exec "$ROOT/bin/emergence" --root "$ROOT" pipeline "$@"
