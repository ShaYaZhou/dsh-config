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
  const sandbox={z:nativeSchema};vm.createContext(sandbox);vm.runInContext(code+'\nthis.settings=Config;',sandbox);
  assert.equal(JSON.stringify(sandbox.settings({})),JSON.stringify({enabled:true,idleMs:3240000,minTokens:200000}));
  for(const value of [0,1.5,Infinity,2147483648])assert.throws(()=>sandbox.settings({idleMs:value}));
  assert.throws(()=>sandbox.settings({minTokens:99999}));
  assert.equal(sandbox.settings({enabled:false}).enabled,false);
});

function fixture(overrides = {}) {
  let now = 0, tick, dispose, resolve;
  const events = new Map(), calls = [], warnings = [];
  const agent = {id:'fixture',status:'idle',inbox:{nextTurn:[],nextStep:[]},session:{id:'fixture'}};
  let tokens = 200001, questions = [];
  const ctx = {
    agents:{list:()=>[agent]},
    on:(event, callback)=>events.set(event, callback),
    effect:callback=>{dispose=callback();},
    sessionProjections:{snapshot:()=>({values:{userQuestions:{active:questions}}})},
    tokenMeter:{measure:()=>({totalTokens:tokens})},
    compaction:{compactNow:async(owner,signal)=>{calls.push({owner,signal});if(overrides.fail)throw new Error('native busy');await new Promise(done=>{resolve=done;});}},
    logger:{warn:message=>warnings.push(message)},
  };
  const code=fs.readFileSync(new URL('../modules/idle-compaction.mjs',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/export const Config = z.object\([\s\S]*?\n\}\);/,'').replace(/^export /gm,'');
  const sandbox={Date:{now:()=>now},AbortController,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{tick=undefined;}};
  vm.createContext(sandbox);vm.runInContext(code+'\nthis.install=apply;',sandbox);
  sandbox.install(ctx,{enabled:true,idleMs:3240000,minTokens:200000,...overrides});
  return {agent,calls,warnings,events,advance:ms=>{now+=ms;},tick:async()=>{tick?.();await new Promise(done=>setImmediate(done));},finish:()=>resolve?.(),dispose:()=>dispose?.(),tokens:value=>{tokens=value;},questions:value=>{questions=value;}};
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
  const f=fixture();f.advance(3239999);f.events.get('session/event')(f.agent.session);f.advance(1);await f.tick();assert.equal(f.calls.length,0);
  f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);
  f.dispose();assert.equal(f.calls[0].signal.aborted,true);f.finish();
});

test('disposed agents cancel maintenance',async()=>{
  const f=fixture();f.advance(3240000);await f.tick();f.events.get('agent/disposed')({agent:f.agent});assert.equal(f.calls[0].signal.aborted,true);f.finish();f.dispose();
});

test('native admission failure is reported without immediate retry',async()=>{
  const f=fixture({fail:true});f.advance(3240000);await f.tick();assert.equal(f.calls.length,1);assert.match(f.warnings[0],/native busy/);await f.tick();assert.equal(f.calls.length,1);f.dispose();
});
