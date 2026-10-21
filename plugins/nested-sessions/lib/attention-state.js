export const ATTENTION_STATUSES = [
  "idle",
  "running",
  "completed",
  "error",
  "blocked",
  "paused",
  "stopped",
  "unavailable",
];

export function attentionAfterEvent(state, event) {
  if (event.type === "turn/start") return "running";
  if (event.type !== "turn/end") return state;
  const reason = event.data.reason;
  switch (reason?.kind) {
    case "completed":
      return "completed";
    case "error":
    case "max-tokens":
      return "error";
    case "blocked":
      return "blocked";
    case "aborted":
      return reason.reason?.kind === "user" ? "stopped" : "paused";
    case "interrupted":
    case "forked":
      return "paused";
    default:
      return "unavailable";
  }
}
