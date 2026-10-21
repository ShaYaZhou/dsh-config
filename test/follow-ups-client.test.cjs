const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");
function client() {
  let exported;
  const createSnapshotStore = (value) => {
    const listeners = new Set();
    return {
      getSnapshot: () => value,
      set: (next) => {
        value = next;
        for (const fn of listeners) fn();
      },
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  };
  const code = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/follow-ups/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, emptyInput, mountSuggestionKeys, affectsOffer, learnPreferences, call, getPreference: () => changed.getSnapshot() };",
    );
  vm.runInNewContext(code, {
    AbortSignal,
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          exported = entry.factory((name) =>
            name === "react"
              ? {}
              : name.includes("client-store")
                ? { createSnapshotStore }
                : { Switch() {} },
          );
        },
      },
    },
  });
  return exported;
}

test("composer suggestions require a genuinely empty unlocked draft without chips, attachments or queued messages", () => {
  const { emptyInput } = client();
  const plain = {
    phase: "plain",
    draft: "",
    attachmentIds: [],
    occurrences: [],
    queue: [],
  };
  assert.equal(emptyInput(plain), true);
  for (const input of [
    undefined,
    { ...plain, draft: " " },
    { ...plain, draft: "my own prompt" },
    { ...plain, phase: "submitting" },
    { ...plain, phase: "claimed" },
    { ...plain, claim: {} },
    { ...plain, attachmentIds: ["image"] },
    { ...plain, occurrences: [{}] },
    { ...plain, queue: [{}] },
  ])
    assert.equal(emptyInput(input), false);
});

function keyboardFixture(session = "session-owned") {
  let handler,
    acceptCount = 0,
    dismissCount = 0;
  const state = {
    eligible: true,
    accept: true,
    menu: false,
    composing: false,
    visible: true,
  };
  const editor = {
    isContentEditable: true,
    contains: (target) => target === editor || target?.parent === editor,
    hasAttribute: () => state.composing,
    getClientRects: () => (state.visible ? [{}] : []),
  };
  const card = {
    querySelector: (selector) =>
      selector === "[data-composer-input]" ? editor : state.menu ? {} : null,
    addEventListener: (name, callback, capture) => {
      assert.equal(name, "keydown");
      assert.equal(capture, true);
      handler = callback;
    },
    removeEventListener: (_name, callback) => {
      assert.equal(handler, callback);
      handler = null;
    },
  };
  const anchor = {
    isConnected: true,
    closest: (selector) =>
      selector === "[data-composer-card]"
        ? card
        : { getAttribute: () => session },
  };
  const off = client().mountSuggestionKeys(anchor, "session-owned", {
    eligible: () => state.eligible,
    accept: () => {
      acceptCount++;
      return state.accept;
    },
    dismiss: () => {
      dismissCount++;
    },
  });
  function key(key, fields = {}) {
    const event = {
      key,
      target: editor,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...fields,
    };
    handler?.(event);
    return event;
  }
  return {
    state,
    anchor,
    editor,
    key,
    off,
    counts: () => ({ acceptCount, dismissCount }),
    attached: () => !!handler,
  };
}

test("Tab and Right adopt only the owned composer, Escape dismisses, and Enter never accepts or sends", () => {
  const f = keyboardFixture();
  assert.equal(f.key("Enter").prevented, false);
  assert.equal(f.key("Tab").prevented, true);
  assert.equal(f.key("ArrowRight").prevented, true);
  assert.equal(f.key("Escape").prevented, true);
  assert.deepEqual(f.counts(), { acceptCount: 2, dismissCount: 1 });
  f.state.accept = false;
  assert.equal(
    f.key("Tab").prevented,
    false,
    "A refused native insertion must keep normal keyboard handling",
  );
  f.off();
  assert.equal(f.attached(), false);
});

test("suggestion keys preserve IME, modifiers, menus, other panes, hidden or detached editors and changed drafts", () => {
  const f = keyboardFixture();
  for (const flag of [
    "isComposing",
    "shiftKey",
    "ctrlKey",
    "metaKey",
    "altKey",
  ])
    assert.equal(f.key("Tab", { [flag]: true }).prevented, false);
  assert.equal(f.key("ArrowRight", { target: {} }).prevented, false);
  for (const key of ["menu", "composing"]) {
    f.state[key] = true;
    assert.equal(f.key("Tab").prevented, false);
    f.state[key] = false;
  }
  f.state.visible = false;
  assert.equal(f.key("Tab").prevented, false);
  f.state.visible = true;
  f.editor.isContentEditable = false;
  assert.equal(f.key("Tab").prevented, false);
  f.editor.isContentEditable = true;
  f.anchor.isConnected = false;
  assert.equal(f.key("Tab").prevented, false);
  f.anchor.isConnected = true;
  f.state.eligible = false;
  assert.equal(f.key("Tab").prevented, false);
  assert.deepEqual(f.counts(), { acceptCount: 0, dismissCount: 0 });
  assert.equal(keyboardFixture("session-other").attached(), false);
});

test("preference revisions prevent old metadata responses from re-enabling a disabled prompt", () => {
  const f = client();
  f.learnPreferences({ promptSuggestions: true, revision: 0 });
  f.learnPreferences({ promptSuggestions: false, revision: 2 });
  f.learnPreferences({ promptSuggestions: true, revision: 1 });
  assert.equal(f.getPreference().promptSuggestions, false);
  f.learnPreferences({ promptSuggestions: true, revision: 3 });
  assert.equal(f.getPreference().promptSuggestions, true);
});

test("offer invalidation ignores token streaming and the client carries the exact owner request and cancellation", async () => {
  const f = client();
  assert.equal(
    f.affectsOffer({
      kind: "append",
      entries: [{ type: "transient", event: { type: "assistant/live-chunk" } }],
    }),
    false,
  );
  for (const type of [
    "plugin:follow-ups/offered",
    "tool/result",
    "turn/end",
    "user/message",
    "sandbox/mode",
    "approval/policy",
    "agent-preset/selected",
  ])
    assert.equal(
      f.affectsOffer({
        kind: "append",
        entries: [{ type: "event", event: { type } }],
      }),
      true,
    );
  let args;
  const controller = new AbortController();
  const ctx = {
    connection: {
      rpc: {
        call: async (...request) => {
          args = request;
          return { ok: false, error: { message: "not confirmed" } };
        },
      },
    },
  };
  await assert.rejects(
    f.call(
      ctx,
      "accept",
      { sessionId: "session-owned", mode: "here" },
      controller.signal,
    ),
    /not confirmed/,
  );
  assert.equal(args[1], "followUps/accept");
  assert.equal(args[2].args.request.sessionId, "session-owned");
  controller.abort();
  assert.equal(args[3].aborted, true);
});
