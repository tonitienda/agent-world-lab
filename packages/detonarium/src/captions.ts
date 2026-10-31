import type { MatchEvent } from "./types.js";

/**
 * One line of commentary for an event, or null to keep it out of the caption feed.
 * `names` holds the display name for each player id.
 */
export function eventCaption(event: MatchEvent, names: string[]): string | null {
  // TODO(human): decide which events are worth a caption and how they read on screen.
  return `${event.type}${"player" in event ? ` (${names[event.player]})` : ""}`;
}
