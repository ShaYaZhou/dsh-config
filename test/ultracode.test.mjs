import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const z = {
  object: () => ({strict() { return this; }}),
  boolean: () => ({nullable() { return this; }}),
};
const sandbox = {
  TypertRemoteService: class { constructor(ctx) {this.ctx=ctx;} },
  Remote: () => () => {},
  runInitializers: () => {},
  RemoteError: Error,
  sessionId: {safeParse: value => ({success: typeof value === "string" && value.length > 0, data: value})},
  z,
  appendPluginRecord: (session, type, data) => session.records.push({type, data}),
};
const code = fs.readFileSync(new URL('../modules/ultracode.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.apply = apply; this.ultracodeProjection = ultracodeProjection; this.UltracodeState = UltracodeState;', sandbox);

function fixture({state = null, defaultActive = false, hasWorkflow = true, delegationMode = "auto"} = {}) {
  const records = [];
  const session = {id: 'session-test', records, header: {origin: 'user'}};
  let section, command;
  const ctx = {
    get: (name) => name === 'enhancementSettings'
      ? {ultracodeDefault: () => defaultActive}
      : name === 'nestedSessions' ? {delegationMode: () => delegationMode} : undefined,
    tools: {get: (name) => (hasWorkflow && name === 'workflow' ? {} : undefined)},
    sessionProjections: {
      register: () => {},
      stateOf: () => state,
    },
    systemPrompt: {section: (value) => { section = value; }},
    commands: {register: (value) => { command = value; return () => {}; }},
    effect: (fn) => fn(),
  };
  sandbox.apply(ctx);
  return {session, section, command, records};
}

test('projection restores only the ultracode record', () => {
  const projection = sandbox.ultracodeProjection;
  const initial = projection.init();
  assert.equal(initial.active, null);
  assert.equal(projection.apply(initial, {type: 'plugin:other/x', data: {active: true}}).active, null);
  assert.equal(projection.apply(initial, {type: 'plugin:ultracode/mode', data: {active: true}}).active, true);
  assert.equal(projection.apply({active: true}, {type: 'plugin:ultracode/mode', data: {active: false}}).active, false);
});

test('the policy section follows the session record and the settings default', () => {
  const off = fixture();
  assert.equal(off.section.name, 'ultracode:policy');
  assert.equal(off.section.text({agent: {session: off.session}}), '');

  const onByDefault = fixture({defaultActive: true});
  assert.match(onByDefault.section.text({agent: {session: onByDefault.session}}), /ultracode is on/);

  const explicitOff = fixture({state: {active: false}, defaultActive: true});
  assert.equal(explicitOff.section.text({agent: {session: explicitOff.session}}), '');
  assert.equal(explicitOff.section.text({}), '');
});

test('the policy is withheld when the session has no workflow tool', () => {
  // 原生 ptc 预设禁用 tool-workflow，三个只读角色预设也没有 delegation 组：
  // 这两种会话开着 ultracode 也不能注入一段指向不存在工具的策略。
  const on = fixture({defaultActive: true, hasWorkflow: false});
  assert.equal(on.section.text({agent: {session: on.session}}), '');

  const explicitOn = fixture({state: {active: true}, hasWorkflow: false});
  assert.equal(explicitOn.section.text({agent: {session: explicitOn.session}}), '');
});

test('/ultracode toggles a restorable session record', () => {
  const f = fixture();
  const run = (rawInput) => f.command.handler({agent: {session: f.session}, rawInput});

  assert.match(run('status').text, /已关闭/);
  assert.match(run('on').text, /已开启/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.records)), [{type: 'plugin:ultracode/mode', data: {active: true}}]);
  assert.equal(f.command.name, 'ultracode');

  const already = fixture({state: {active: true}});
  assert.match(already.command.handler({agent: {session: already.session}, rawInput: 'on'}).text, /已经是开启/);
  assert.equal(already.records.length, 0);

  assert.equal(run('bogus').kind, 'error');
});

 test('explicit linked collaboration takes priority and off does not disable workflows', () => {
  const linked = fixture({state: {active: true}, delegationMode: 'linked'});
  assert.doesNotMatch(linked.section.text({agent: {id: 'session-test', session: linked.session}}), /default to dynamic orchestration/);
  assert.match(linked.command.handler({agent: {id: 'session-test', session: linked.session}, rawInput: 'status'}).text, /关联会话优先/);
  const off = fixture({state: {active: true}, delegationMode: 'off'});
  assert.match(off.section.text({agent: {id: 'session-test', session: off.session}}), /ultracode is on/);
 });
 test('status distinguishes requested on from unavailable workflow', () => {
  const f = fixture({state: {active: true}, hasWorkflow: false});
  assert.match(f.command.handler({agent: {session: f.session}, rawInput: 'status'}).text, /未生效/);
 });

test('linked workers do not receive automatic orchestration and auto restores it', () => {
 const child = fixture({state:{active:true}, delegationMode:'worker'});
 assert.equal(child.section.text({agent:{session:child.session}}), '');
 const restored = fixture({state:{active:true}, delegationMode:'auto'});
 assert.match(restored.section.text({agent:{session:restored.session}}), /Collect actual terminal results/);
});

 test('unsupported on refuses before persisting a misleading enabled preference', () => {
  const f=fixture({hasWorkflow:false});
  const result=f.command.handler({agent:{session:f.session},rawInput:'on'});
  assert.equal(result.kind,'error'); assert.equal(f.records.length,0);
 });
 test('status read checks ownership and cancellation again after agent resolution', async () => {
  let allowed=false, calls=0, resolve;
  const session={id:'owner',records:[]};
  const ctx={remoteAccess:{allows:()=>allowed},sessionController:{resolveAgent:()=>{calls++;return new Promise(r=>resolve=r);}},tools:{get:()=>({})},get:()=>undefined,sessionProjections:{stateOf:()=>({active:true})}};
  const service=new sandbox.UltracodeState(ctx);
  await assert.rejects(service.read({sessionId:'owner'}));assert.equal(calls,0);
  allowed=true; const pending=service.read({sessionId:'owner'});allowed=false;resolve({agent:{id:'owner',session}});await assert.rejects(pending);
  allowed=true; const controller=new AbortController();const cancelled=service.read({sessionId:'owner'},controller.signal);controller.abort();resolve({agent:{id:'owner',session}});await assert.rejects(cancelled);
  const success=service.read({sessionId:'owner'});resolve({agent:{id:'owner',session}});assert.equal((await success).mode,'workflow');
 });
