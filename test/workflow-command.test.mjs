import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../modules/workflow-command.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
function fixture(available = true, engine, failPrompt = false) {
  const sandbox = {randomUUID: () => 'request-test', AbortSignal};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.apply = apply;', sandbox);
  const requests = [];
  let command;
  sandbox.apply({
    workflowEngine: engine,
    effect: fn => fn(),
    commands: {register: value => { command = value; }},
    tools: {get: () => available ? {} : undefined},
    sessionController: {prompt: async (request, signal) => { signal.throwIfAborted(); requests.push(request); if(failPrompt)throw new Error("prompt rejected"); }},
  });
  return {requests, run: (rawInput, signal) => command.handler({rawInput, signal, agent: {session: {id: 'owner'}}})};
}
test('workflow command only submits an explicit bounded task to its owning session', async () => {
  const f = fixture();
  assert.equal((await f.run('')).kind, 'success');
  assert.equal(f.requests.length, 0);
  assert.equal((await f.run('audit fixture')).kind, 'success');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].sessionId, 'owner');
  assert.equal(f.requests[0].mode, 'queue');
  assert.match(f.requests[0].content[0].text, /audit fixture$/);
  assert.match(f.requests[0].content[0].text, /不修改任何模式开关/);
  assert.equal((await f.run('x'.repeat(16001))).kind, 'error');
  await assert.rejects(f.run('cancelled', AbortSignal.abort()));
  assert.equal(f.requests.length, 1);
});
test('unavailable workflow refuses before enqueue', async () => {
  const f = fixture(false);
  assert.equal((await f.run('task')).kind, 'error');
  assert.equal(f.requests.length, 0);
});

test('resume uses the original owned request and stop never queues model work', async () => {
 let granted,stops=0;
 const id='11111111-1111-4111-8111-111111111111';
 const engine={resumeRequest:()=>({meta:{name:'original'},script:'original script',args:{},resume_from_run_id:id}),authorizeStart:(_agent,runId,requestId)=>{granted={runId,requestId};return()=>{};},stopRun:async()=>{stops++;}};
 const f=fixture(true,engine);
 assert.equal((await f.run('resume '+id)).kind,'success');
 assert.deepEqual(granted,{runId:id,requestId:'request-test'});
 assert.match(f.requests[0].content[0].text,/original script/);
 assert.equal((await f.run('stop '+id)).kind,'success');assert.equal(stops,1);assert.equal(f.requests.length,1);
 assert.equal((await f.run('resume bad')).kind,'error');
});
test('failed prompt revokes the unused human start grant', async () => {
 let revoked=0;
 const f=fixture(true,{authorizeStart:()=>()=>revoked++},true);
 await assert.rejects(f.run('new task'),/prompt rejected/);
 assert.equal(revoked,1);
});

test('stopped owners require explicit resume or reviewed new task',async()=>{
 let grants=0;
 const f=fixture(true,{isBlocked:()=>true,authorizeStart:()=>{grants++;return()=>{};}});
 assert.equal((await f.run('continue')).kind,'error');assert.equal(grants,0);assert.equal(f.requests.length,0);
 assert.equal((await f.run('new separate reviewed task')).kind,'success');assert.equal(grants,1);
});
