const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

function client() {
  let exported;
  const code = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/ultracode-control/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, effectiveState, defaultOn, STYLE };",
    );
  vm.runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          exported = entry.factory(() => ({}));
        },
      },
    },
  });
  return exported;
}

test("explicit session state wins over the new-session default", () => {
  const { effectiveState } = client();
  assert.equal(effectiveState({ active: true }, false), true);
  assert.equal(effectiveState({ active: false }, true), false);
  assert.equal(effectiveState({ active: null }, true), true);
  assert.equal(effectiveState({ active: null }, false), false);
  assert.equal(effectiveState(undefined, true), true);
});

test("the default comes from the Harness enhancement form snapshot", () => {
  const { defaultOn } = client();
  assert.equal(defaultOn({ value: { ultracodeDefault: true } }), true);
  assert.equal(defaultOn({ value: {}, base: { ultracodeDefault: true } }), true);
  assert.equal(defaultOn({ value: { ultracodeDefault: false } }), false);
  assert.equal(defaultOn(undefined), false);
});

test("the pill animates only when on and respects reduced motion", () => {
  const { STYLE } = client();
  assert.match(STYLE, /@keyframes uc-sheen/);
  assert.match(STYLE, /@keyframes uc-pulse/);
  assert.match(STYLE, /prefers-reduced-motion:reduce/);
});

test("toggling sends the existing /ultracode command and surfaces failures", async () => {
  const { inject, apply } = client();
  assert.deepEqual([...inject], ["slots", "sessions", "configForms"]);

  const sent = [];
  let outcome = { ok: true, value: { matched: true } };
  let toggle;
  const ctx = {
    configForms: { get: (id) => ({ id }) },
    sessions: {
      binding: () => ({
        session: {
          command: async (text) => {
            sent.push(text);
            return outcome;
          },
        },
      }),
    },
    slots: {
      inject: (name, run) => run(),
      register: (entry) => {
        assert.equal(entry.name, "conversation.input.right");
        assert.equal(entry.id, "ultracode-control");
        const injected = entry.inject("s1");
        assert.equal(injected.hooks.ultracodeSetting.id, "enhancement-settings");
        toggle = injected.toggle;
      },
    },
  };

  apply(ctx);
  await toggle(false);
  await toggle(true);
  assert.deepEqual(sent, ["/ultracode off", "/ultracode on"]);

  outcome = { ok: true, value: { matched: false } };
  await assert.rejects(toggle(true), /宿主未提供 \/ultracode 命令/);
  outcome = { ok: false, error: { message: "boom" } };
  await assert.rejects(toggle(true), /boom/);

  ctx.sessions.binding = () => undefined;
  await assert.rejects(toggle(true), /当前会话尚未就绪/);
});
