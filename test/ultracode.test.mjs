import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const z = {
  object: () => ({strict() { return this; }}),
  boolean: () => ({nullable() { return this; }}),
};
const sandbox = {
  Script: vm.Script,
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
vm.runInContext(code + '\nthis.apply = apply; this.ultracodeProjection = ultracodeProjection; this.UltracodeState = UltracodeState; this.coordinatorCall = coordinatorCall;', sandbox);

function fixture({state = null, defaultActive = false, hasWorkflow = true, delegationMode = "auto"} = {}) {
  const records = [];
  const session = {id: 'session-test', records, header: {origin: 'user'}, snapshotEvents: () => []};
  let section, command, guard;
  const ctx = {
    get: (name) => name === 'enhancementSettings'
      ? {ultracodeDefault: () => defaultActive}
      : name === 'nestedSessions' ? {delegationMode: () => delegationMode} : undefined,
    tools: {get: (name) => (hasWorkflow && name === 'workflow' ? {} : undefined),guard: fn => {guard=fn;return ()=>{};}},
    sessionProjections: {
      register: () => {},
      stateOf: () => state,
    },
    systemPrompt: {section: (value) => { section = value; }},
    commands: {register: (value) => { command = value; return () => {}; }},
    effect: (fn) => fn(),
  };
  sandbox.apply(ctx);
  return {session, section, command, records, guard, ctx};
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
  assert.match(onByDefault.section.text({agent: {session: onByDefault.session}}), /Ultracode is on/);

  const explicitOff = fixture({state: {active: false}, defaultActive: true});
  assert.equal(explicitOff.section.text({agent: {session: explicitOff.session}}), '');
  assert.equal(explicitOff.section.text({}), '');
});

test('the policy is withheld when the session has no workflow tool', () => {
  // 原生 ptc 预设禁用 tool-workflow，三个只读角色预设也没有 delegation 组：
  // 这两种会话开着 ultracode 也不能注入一段指向不存在工具的策略。
  const on = fixture({defaultActive: true, hasWorkflow: false});
  assert.equal(on.section.text({agent: {session: on.session}}), '');
  assert.equal(on.guard({agent:{session:on.session},name:'write',arguments:{}}),undefined,'Unavailable Ultracode must not disable the underlying preset');

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
  assert.match(linked.section.text({agent: {id: 'session-test', session: linked.session}}), /MUST enter workflow/);
  assert.match(linked.command.handler({agent: {id: 'session-test', session: linked.session}, rawInput: 'status'}).text, /持久关联会话/);
  const off = fixture({state: {active: true}, delegationMode: 'off'});
  assert.match(off.section.text({agent: {id: 'session-test', session: off.session}}), /Ultracode is on/);
 });
 test('status distinguishes requested on from unavailable workflow', () => {
  const f = fixture({state: {active: true}, hasWorkflow: false});
  assert.match(f.command.handler({agent: {session: f.session}, rawInput: 'status'}).text, /未生效/);
 });

test('linked workers do not receive automatic orchestration and auto restores it', () => {
 const child = fixture({state:{active:true}, delegationMode:'worker'});
 assert.equal(child.section.text({agent:{session:child.session}}), '');
 const restored = fixture({state:{active:true}, delegationMode:'auto'});
 assert.match(restored.section.text({agent:{session:restored.session}}), /Await completed results/);
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


test('Ultracode guard blocks direct execution and permits only bounded preparation', () => {
 const f=fixture({state:{active:true}}),agent={id:'root',session:f.session};
 for(const name of ['write','edit','bash','subagent','start_session','mcp__playwright__browser_evaluate'])
  assert.match(f.guard({agent,name,arguments:{}}),/requires workflow/);
 assert.equal(f.guard({agent,name:'workflow',arguments:{}}),undefined);
 assert.equal(f.guard({agent,name:'render_widget',arguments:{html:'<div>answer</div>'}}),undefined);
 for(let i=0;i<6;i++)assert.equal(f.guard({agent,name:'read',arguments:{}}),undefined);
 assert.match(f.guard({agent,name:'read',arguments:{}}),/limit reached/);
 const off=fixture({state:{active:false}});
 assert.equal(off.guard({agent:{session:off.session},name:'write'}),undefined);
});

test('PTC envelope accepts JSON only and never permits raw code or nested expressions', () => {
 const f=fixture({state:{active:true}}),agent={session:f.session};
 assert.equal(f.guard({agent,name:'run_code',arguments:{code:'console.log(await tools.workflow({"script":"return 1","meta":{"name":"x"}}));'}}),undefined);
 assert.equal(f.guard({agent,name:'run_code',arguments:{code:'console.log(\n await tools.read( {"file_path":"a"} )\n);'}}),undefined);
 for(const code of ['await import("node:fs")','console.log(await tools.write({"content":"x"}));',
  'console.log(await tools.workflow({"x":(process.exit(),1)}));',
  'console.log(await tools.read({})); await tools.write({});'])
  assert.match(f.guard({agent,name:'run_code',arguments:{code}}),/single literal JSON/);
});

test('workers cannot spawn competing writers or nested workflows', () => {
 const f=fixture({state:{active:true}}),agent={session:{...f.session,header:{origin:'subagent'}}};
 assert.equal(f.section.text({agent}),'');
 assert.match(f.guard({agent,name:'subagent',arguments:{agent_preset:'standard'}}),/read-only/);
 assert.equal(f.guard({agent,name:'subagent',arguments:{agent_preset:'reviewer'}}),undefined);
 assert.match(f.guard({agent,name:'workflow',arguments:{}}),/no nested/);
 assert.equal(f.guard({agent,name:'write',arguments:{}}),undefined);
});


test('worker restrictions follow the parent mode, not the child default', () => {
 const f=fixture({state:{active:true}}),parent={id:'parent',session:{header:{origin:'user'}}};
 const child={id:'child',session:{header:{origin:'subagent',parentSession:'parent'}}};
 const get=f.ctx.get;f.ctx.get=name=>name==='agents'?{get:id=>id==='parent'?parent:undefined}:get(name);
 f.ctx.sessionProjections.stateOf=session=>({active:session===parent.session?false:true});
 assert.equal(f.guard({agent:child,name:'subagent',arguments:{agent_preset:'standard'}}),undefined);
 f.ctx.sessionProjections.stateOf=session=>({active:session===parent.session?true:false});
 assert.match(f.guard({agent:child,name:'subagent',arguments:{agent_preset:'standard'}}),/read-only/);
 assert.match(f.guard({agent:child,name:'send_session_message',arguments:{}}),/no nested/);
});

test('read-only workflow helpers cannot race on their shared role memory file',()=>{
 const f=fixture({state:{active:true}});
 const agent={session:{...f.session,header:{origin:'subagent',agentPreset:'reviewer'}}};
 assert.match(f.section.text({agent}),/strictly read-only/);
 assert.match(f.guard({agent,name:'write',arguments:{file_path:'MEMORY.md',content:'note'}}),/shared role memory/);
 assert.equal(f.guard({agent,name:'read',arguments:{file_path:'MEMORY.md'}}),undefined);
});

test('PTC diagnostics distinguish missing delimiters from non-JSON arguments',()=>{
 const f=fixture({state:{active:true}}),agent={session:f.session};
 assert.match(f.guard({agent,name:'run_code',arguments:{code:'console.log(await tools.workflow({"script":"return 1","meta":{"name":"x"}})'}}),/syntax error/i);
 assert.match(f.guard({agent,name:'run_code',arguments:{code:'console.log(await tools.read({file_path:"a"}));'}}),/double quotes/);
});

test('coordinator diagnostics compile but never execute rejected code',()=>{
 const f=fixture({state:{active:true}}),agent={session:f.session};
 try {
  assert.match(f.guard({agent,name:'run_code',arguments:{code:'globalThis.__ultracodeDiagnosticExecuted = true;'}}),/single literal JSON/);
  assert.equal(globalThis.__ultracodeDiagnosticExecuted,undefined);
 } finally {delete globalThis.__ultracodeDiagnosticExecuted;}
});
