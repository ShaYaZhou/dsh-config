import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

let nativeSchema;
try { nativeSchema=createRequire(path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/package.json'))('@deepseek-ai/schemastery'); } catch {}
test('idle settings use the actual native schema and reject invalid intervals', {skip:!nativeSchema && 'Requires installed Harness schema runtime'},()=>{
  const code=fs.readFileSync(new URL('../modules/idle-compaction.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const sandbox={z:nativeSchema,Service:class {}};vm.createContext(sandbox);vm.runInContext(code+'\nthis.settings=Config;',sandbox);
  const settings=sandbox.settings({});
  assert.equal(settings.enabled.get(),true);
  assert.equal(settings.idleMs,3240000);
  assert.equal(settings.minTokens,200000);
  for(const value of [0,1.5,Infinity,2147483648])assert.throws(()=>sandbox.settings({idleMs:value}));
  assert.throws(()=>sandbox.settings({minTokens:99999}));
  assert.equal(sandbox.settings({enabled:false}).enabled.get(),false);
});

function fixture(overrides = {}) {
  let now = 0, tick, dispose, resolve;
  const events = new Map(), calls = [], warnings = [];
  const agent = {id:'fixture',status:'idle',inbox:{nextTurn:[],nextStep:[]},session:{id:'fixture',snapshotEvents:()=>overrides.events??[]}};
  const agents=[agent];
  let tokens = 200001, questions = [];
  const ctx = {
    agents:{list:()=>agents},
    workspaceRegistry:{archivedSessionIds:[]},
    on:(event, callback)=>events.set(event, callback),
    effect:callback=>{dispose=callback();},
    sessionProjections:{snapshot:()=>({values:{userQuestions:{active:questions}}})},
    tokenMeter:{measure:()=>({totalTokens:tokens})},
    compaction:{compactNow:async(owner,signal)=>{calls.push({owner,signal});if(overrides.cancel)throw Object.assign(new Error('native cancellation'),{code:'cancelled'});if(overrides.fail)throw new Error('native busy');await new Promise(done=>{resolve=done;});}},
    logger:{warn:message=>warnings.push(message)},
  };
  const code=fs.readFileSync(new URL('../modules/idle-compaction.mjs',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/export const Config = z.object\([\s\S]*?\n\}\);/,'').replace(/^export /gm,'');
  const owner={};
  const sandbox={Service:class {constructor(context,name){context[name]=this;}},scopeChainOf:current=>current.ancestry??[owner],Date:{now:()=>now},AbortController,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{tick=undefined;}};
  vm.createContext(sandbox);vm.runInContext(code+'\nthis.install=apply;',sandbox);
  sandbox.install(ctx,{enabled:true,idleMs:3240000,minTokens:200000,...overrides});
  ctx.localIdleCompaction.register(owner,ctx.compaction,ctx.tokenMeter);
  return {agent,calls,warnings,events,registry:ctx.localIdleCompaction,owner,addAgent:other=>{agents.push(other);events.get('agent/created')({agent:other});},advance:ms=>{now+=ms;},tick:async()=>{tick?.();await new Promise(done=>setImmediate(done));},finish:()=>resolve?.(),dispose:()=>dispose?.(),tokens:value=>{tokens=value;},questions:value=>{questions=value;},archive:()=>ctx.workspaceRegistry.archivedSessionIds.push(agent.id)};
}

test('idle compaction respects age, tokens, pending work, questions and off switch',async()=>{
  const f=fixture();
  await f.tick();assert.equal(f.calls.length,0);
  f.advance(3240000);f.tokens(199999);await f.tick();assert.equal(f.calls.length,0);
  f.tokens(200001);f.questions([{callId:'pending'}]);await f.tick();assert.equal(f.calls.length,0);
  f.questions([]);f.agent.status='running';await f.tick();assert.equal(f.calls.length,0);
  f.agent.status='idle';f.agent.inbox.nextTurn.push({});await f.tick();assert.equal(f.calls.length,0);
  f.agent.inbox.nextTurn=[];f.agent.inbox.nextStep.push({});await f.tick();assert.equal(f.calls.length,0);
  f.agent.inbox.nextStep=[];await f.tick();assert.equal(f.calls.length,1);
  await f.tick();assert.equal(f.calls.length,1);
  f.finish();await new Promise(done=>setImmediate(done));f.dispose();
  const off=fixture({enabled:false});off.advance(3240001);await off.tick();assert.equal(off.calls.length,0);
});

test('activity resets the deadline and unloading cancels an admitted summary',async()=>{
  const f=fixture();f.advance(3239999);f.events.get('session/event')(f.agent.session,{type:'user/message'});f.advance(1);await f.tick();assert.equal(f.calls.length,0);
  f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);
  f.dispose();assert.equal(f.calls[0].signal.aborted,true);f.finish();
});

test('disposed agents cancel maintenance',async()=>{
  const f=fixture();f.advance(3240000);await f.tick();f.events.get('agent/disposed')({agent:f.agent});assert.equal(f.calls[0].signal.aborted,true);f.finish();f.dispose();
});

test('native admission failure is reported without immediate retry',async()=>{
  const f=fixture({fail:true});f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);assert.match(f.warnings[0],/native busy/);await f.tick();assert.equal(f.calls.length,1);f.dispose();
});

test('the live native switch cancels only maintenance and re-enabling starts a new idle deadline',async()=>{
  let enabled=true;
  const f=fixture({enabled:{get:()=>enabled}});f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);
  enabled=false;f.events.get('loader/volatile-update')();assert.equal(f.calls[0].signal.aborted,true);f.finish();await new Promise(done=>setImmediate(done));
  f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);
  enabled=true;f.events.get('loader/volatile-update')();await f.tick();assert.equal(f.calls.length,1);
  f.advance(3240000);await f.tick();assert.equal(f.calls.length,2);f.finish();f.dispose();
});

test('the scheduler skips agents outside the bound engine composition',async()=>{
  const f=fixture();f.agent.ancestry=[];f.advance(3240000);await f.tick();assert.equal(f.calls.length,0);f.dispose();
});

test('aborted turns and archives stay paused, and native user cancellation waits for a new turn',async()=>{
  const stopped=fixture({events:[{type:'turn/end',data:{reason:{kind:'aborted'}}}]});stopped.advance(3240000);await stopped.tick();assert.equal(stopped.calls.length,0);stopped.dispose();
  const archived=fixture();archived.archive();archived.advance(3240000);await archived.tick();assert.equal(archived.calls.length,0);archived.dispose();
  const f=fixture({cancel:true});f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);assert.equal(f.warnings.length,0);f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);
  f.events.get('session/event')(f.agent.session,{type:'turn/start'});f.advance(3240000);await f.tick();assert.equal(f.calls.length,2);f.dispose();
});

test('engine bindings choose the nearest scope and release without affecting another composition',()=>{
  const f=fixture(),near={};
  assert.throws(()=>f.registry.register(f.owner,{},{}),/one engine/);
  const release=f.registry.register(near,{id:'near'},{});
  assert.equal(f.registry.forAgent({ancestry:[near,f.owner]}).engine.id,'near');release();
  assert.equal(f.registry.forAgent({ancestry:[near,f.owner]}),f.registry.forAgent(f.agent));f.dispose();
});

test('native archive admission sees maintenance and stopActivity cancels its exact signal',async()=>{
  const f=fixture();f.advance(3240000);await f.tick();
  const activity=await f.events.get('workspace/session-activity')({sessionId:f.agent.id},async()=>[]);
  assert.equal(activity[0].kind,'turn');
  const unrelated=await f.events.get('workspace/session-activity')({sessionId:'other'},async()=>[{kind:'job'}]);assert.equal(unrelated.length,1);
  f.events.get('workspace/session-stop')({sessionId:f.agent.id});assert.equal(f.calls[0].signal.aborted,true);f.finish();f.dispose();
});

test('slow summaries do not let another timer start concurrent maintenance for a second session',async()=>{
  const f=fixture();f.addAgent({...f.agent,id:'second',session:{...f.agent.session,id:'second'}});f.advance(3240000);
  try {
    await f.tick();assert.equal(f.calls.length,1);await f.tick();assert.equal(f.calls.length,1);
    f.finish();await new Promise(done=>setImmediate(done));assert.equal(f.calls.length,2);assert.equal(f.calls[1].owner.id,'second');f.finish();
  } finally {f.dispose();}
});
