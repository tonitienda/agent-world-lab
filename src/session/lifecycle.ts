export type SessionOutcome = "completed" | "stopped" | "aborted";
/** One finalizer shared by MCP tools, operator control, signals and transport closure. */
export class SessionLifecycle {
  private finalizing?: Promise<void>;
  outcome?: SessionOutcome;
  finish(outcome: SessionOutcome, finalize: () => Promise<void>) {
    if (!this.finalizing) {
      this.outcome = outcome;
      this.finalizing = Promise.resolve().then(finalize);
    }
    return this.finalizing;
  }
}
