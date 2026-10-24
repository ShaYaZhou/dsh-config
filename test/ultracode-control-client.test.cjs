const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

function client(React = {}) {
  let exported;
  const code = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/ultracode-control/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, effectiveState, defaultOn, chipState, UltracodeChip, STYLE };",
    );
  vm.runInNewContext(code, {
    AbortController, setInterval: () => 1, clearInterval: () => {},
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          exported = entry.factory(name => name === "react" ? React : {});
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
  assert.deepEqual([...inject], ["slots", "sessions", "configForms", "connection"]);

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

 test('unsupported modes stay disabled and linked workflows display enabled', () => {
   const {chipState} = client();
   for (const state of [null, {error:'offline'}, {supported:false,requested:true,mode:'unavailable'}]) {
     const view = chipState(state,true); assert.equal(view.active,false); assert.equal(view.disabled,true);
   }
   assert.match(chipState({supported:false},true).label,/不可用/);
   assert.match(chipState({supported:true,mode:'linked'},true).label,/关联执行/);
   assert.equal(chipState({supported:true,mode:'linked'},true).active,true);
   assert.equal(chipState({supported:true,mode:'workflow'},true).active,true);
 });

test('status transport is owner scoped and rejects mismatched or failed replies', async () => {
  const {apply}=client(); let readStatus; let outcome={ok:true,value:{sessionId:'owner',supported:false}};
  const calls=[];
  apply({configForms:{get:()=>({})},sessions:{},connection:{rpc:{call:async(...args)=>{calls.push(args);return outcome;}}},slots:{inject:(_name,run)=>run(),register:entry=>{readStatus=entry.inject('owner').readStatus;}}});
  const signal=new AbortController().signal;
  assert.equal((await readStatus(signal)).supported,false);
  assert.equal(calls[0][1],'ultracodeState/read');assert.equal(calls[0][2].args.request.sessionId,'owner');assert.equal(calls[0][3],signal);
  outcome={ok:true,value:{sessionId:'other'}};await assert.rejects(readStatus(signal),/会话已变化/);
  outcome={ok:false,error:{message:'denied'}};await assert.rejects(readStatus(signal),/denied/);
});

test('unmounted status lookup is aborted and its late response is ignored', async () => {
  const effects=[], updates=[]; let settle,signal;
  const React={Fragment:'fragment',createElement:()=>({}),useState:initial=>[initial,v=>updates.push(v)],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
  const {UltracodeChip}=client(React);
  UltracodeChip({useProjection:name=>name==='ultracode'?{active:true}:'ptc',useUltracodeSetting:()=>false,toggle:()=>{},readStatus:s=>{signal=s;return new Promise(r=>settle=r);}});
  const cleanups=effects.map(fn=>fn());
  const before=updates.length;
  cleanups.forEach(fn=>fn?.());
  assert(signal.aborted);
  settle({supported:true,mode:'workflow'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.length,before);
});
