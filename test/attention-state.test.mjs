import test from "node:test";
import assert from "node:assert/strict";
import { attentionAfterEvent } from "../plugins/nested-sessions/lib/attention-state.js";

test("attention folds actual turn endings without treating stop/error/unread as completion", () => {
  assert.equal(attentionAfterEvent("idle", { type: "turn/start" }), "running");
  for (const [reason, status] of [
    [{ kind: "completed" }, "completed"],
    [{ kind: "error" }, "error"],
    [{ kind: "blocked" }, "blocked"],
    [{ kind: "aborted", reason: { kind: "user" } }, "stopped"],
    [{ kind: "aborted", reason: { kind: "shutdown" } }, "paused"],
    [{ kind: "interrupted" }, "paused"],
    [{ kind: "max-tokens" }, "error"],
    [{ kind: "future-reason" }, "unavailable"],
  ])
    assert.equal(
      attentionAfterEvent("running", { type: "turn/end", data: { reason } }),
      status,
    );
  assert.equal(
    attentionAfterEvent("idle", { type: "assistant/message" }),
    "idle",
  );
  assert.equal(
    attentionAfterEvent("stopped", { type: "user/message" }),
    "stopped",
  );
});
