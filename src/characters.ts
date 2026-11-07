// Roster of named on-screen characters (characters/roster.json), shared with the
// Go CLI (package characters). TypeScript runners such as Detonarium read the same
// file so a character has one name, voice and accent everywhere.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Character = {
  id: string;
  name: string;
  family: "claude" | "codex";
  accent: string;
  voice: string;
};

const FAMILY_DISPLAY = { claude: "Claude", codex: "Codex" } as const;
const ROSTER = resolve(import.meta.dirname, "../characters/roster.json");

export function loadRoster(file = ROSTER): Character[] {
  const doc = JSON.parse(readFileSync(file, "utf8")) as { characters: Character[] };
  return doc.characters;
}

export function lookupCharacter(id: string, file = ROSTER): Character {
  const roster = loadRoster(file);
  const found = roster.find((c) => c.id === id);
  if (!found) throw new Error(`unknown character ${id} (roster: ${roster.map((c) => c.id).join(", ")})`);
  return found;
}

/** On-screen name, e.g. "Ada · Claude"; matches Character.Label in Go. */
export function characterLabel(c: Character): string {
  return `${c.name} · ${FAMILY_DISPLAY[c.family]}`;
}

/** Prompt section appended after the goal; matches Character.Brief in Go. */
export function characterBrief(c: Character): string {
  return `## Your character\n\n${c.voice}\n`;
}
