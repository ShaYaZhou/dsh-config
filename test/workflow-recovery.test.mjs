import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkflowJournal,readRun,stopOwner,ownerStopped,releaseOwner} from '../plugins/workflow-ptc/lib/journal.js';

const request={seq:1,prompt:'append exactly once',schema:undefined};
const header={name:'fixture',provider:'spawn',identity:{owner:'owner',cwd:'/fixture',policy:{mode:'workspace-write'},model:'fixture',limits:{budgetMs:180000}},script:'fixed script',args:{n:1}};
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-recovery-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const create=(h=header,from)=>{const id=randomUUID();return {id,j:new WorkflowJournal(root,id,h,()=>{},from)};};
  return {root,create};
}
function completeCall(j) {j.recordIntent(request,'spawn');j.recordCall(request,'spawn','child-one');j.recordResult(1,{output:[{type:'text',text:'done'}],stopReason:'completed'});}

test('completed writes replay across multiple generations and an ancestor cannot fork twice',t=>{
  const {root,create}=fixture(t);const a=create();completeCall(a.j);a.j.finish({stopReason:'error'});
  const b=create(header,a.id);assert.equal(b.j.takeReplay(request,'spawn').childId,'child-one');b.j.finish({stopReason:'completed'});
  assert.throws(()=>create(header,a.id),/successor/);
  const c=create(header,b.id);assert.equal(c.j.takeReplay(request,'spawn').result.output[0].text,'done');c.j.finish({stopReason:'completed'});
  assert.equal(readRun(root,c.id).entries.size,1);
});
test('active and unconfirmed runs block concurrent starts and cold recovery',t=>{
  const {root,create}=fixture(t);const a=create();a.j.recordIntent(request,'spawn');
  assert.throws(()=>create(),/active or unconfirmed/);
  assert.throws(()=>readRun(root,a.id),/quiesced or crashed/);
  a.j.finish({stopReason:'cancelled'});
  assert.throws(()=>create(header,a.id),/may have applied writes/);
});
test('failed child results cannot be silently replayed or re-executed',t=>{
  const {create}=fixture(t);const a=create();a.j.recordIntent(request,'spawn');a.j.recordCall(request,'spawn','failed');
  a.j.recordResult(1,{output:[],stopReason:'error'});a.j.finish({stopReason:'error'});
  assert.throws(()=>create(header,a.id),/reconcile/);
});
test('ownership, directory, permission, model, script and inputs must match',t=>{
  const {create}=fixture(t);const a=create();completeCall(a.j);a.j.finish({stopReason:'completed'});
  for(const change of [{owner:'other'},{cwd:'/elsewhere'},{policy:{mode:'danger-full-access'}},{model:'other'},{limits:{budgetMs:360000}}])
    assert.throws(()=>create({...header,identity:{...header.identity,...change}},a.id),/changed/);
  assert.throws(()=>create({...header,script:'changed'},a.id),/changed/);
  assert.throws(()=>create({...header,args:{n:2}},a.id),/changed/);
});
test('corrupt or legacy journals never fall through into fresh execution',t=>{
  const {root,create}=fixture(t);const a=create();completeCall(a.j);a.j.finish({stopReason:'completed'});
  fs.appendFileSync(path.join(root,a.id+'.jsonl'),'broken');assert.throws(()=>create(header,a.id),/corrupt/);
  const id=randomUUID();fs.writeFileSync(path.join(root,id+'.jsonl'),JSON.stringify({t:'run',v:1,runId:id}));
  assert.throws(()=>create(header,id),/legacy/);
});
test('replay mismatch blocks new work, and stop latch survives a new reader',t=>{
  const {root,create}=fixture(t);const a=create();completeCall(a.j);a.j.finish({stopReason:'completed'});
  const b=create(header,a.id);
  assert.throws(()=>b.j.takeReplay({...request,prompt:'different'},'spawn'),/changed/);
  assert.throws(()=>b.j.takeReplay({...request,seq:2},'spawn'),/before replaying/);
  b.j.finish({stopReason:'error'});
  stopOwner(root,'owner',b.id);assert(ownerStopped(root,'owner'));releaseOwner(root,'owner');assert(!ownerStopped(root,'owner'));
});

function runtimeFixture({unsettled=false,cleanupFailure=false}={}) {
  const source=fs.readFileSync(new URL('../plugins/workflow-ptc/lib/index.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('var PtcWorkflowRun = class'),source.indexOf('import { realpathSync }'));
  const Run=vm.runInNewContext(code+';PtcWorkflowRun',{AbortController,Promise,realpathSync:x=>x,PROGRAM:'fixture',json:x=>x,workflowResult:x=>x,renderThrown:String});
  const ends=[],guards=[],stops=[];
  const run=new Run({workingDirectory:{ensure:()=>Promise.resolve('/fixture')},logger:{warn:()=>{}}},{},{sandboxMode:true,resolve:x=>x,run:async()=>({value:{value:null,stopReason:'completed',agentsStarted:0}})},'run',{}, {session:{id:'owner'}},{},'spawn',{mode:'workspace-write'},{agentEnd:()=>{}},{cwd:'/fixture',journal:{hasUnsettled:unsettled,finish:r=>ends.push(r)},stopOwner:()=>stops.push(true),onChildActive:(_id,active)=>guards.push(active)});
  if(cleanupFailure)run.children.set(1,{callId:1,run:{childId:'child',dispose:async()=>{throw new Error('provider cleanup failed');}}});
  return {run,ends,guards,stops};
}
test('unfinished child calls cannot be reported as successful completion',async()=>{
 const f=runtimeFixture({unsettled:true});const result=await f.run.result;
 assert.equal(result.stopReason,'error');assert.equal(f.ends[0].stopReason,'error');assert.equal(f.stops.length,1);
});
test('unconfirmed cleanup keeps the recovery lock and child depth guard',async()=>{
 const f=runtimeFixture({cleanupFailure:true});const result=await f.run.result;
 assert.equal(result.stopReason,'error');assert.equal(f.ends.length,0);assert.deepEqual(f.guards,[]);assert.equal(f.run.cleanupFailed,true);
});

test('cleanup uncertainty refuses the next stage before another child is admitted',async()=>{
 const f=runtimeFixture();f.run.cleanupFailed=true;
 assert.throws(()=>f.run.requireActive(),/cleanup/);
 await f.run.result;
});

test('workflow worker selection cannot bypass collaborate off or on',()=>{
 const source=fs.readFileSync(new URL('../plugins/workflow-ptc/lib/index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('var PtcWorkflowEngine = class'),source.indexOf('var index_default = PtcWorkflowEngine'));
 const schema=new Proxy(()=>{}, {get:()=>schema,apply:()=>schema});
 const Engine=vm.runInNewContext(code+';PtcWorkflowEngine',{
  WorkflowEngine:class {constructor(ctx){this.ctx=ctx;}},z:schema,
  validateMeta:x=>x,assertBodyParses:()=>{},WorkflowError3:Error,
 });
 const parent={session:{id:'owner'}};
 for(const [preference,workerMode,pattern] of [['off','linked',/disabled/],['worker','linked',/disabled/],['linked','subagent',/collaborate on/],['auto','unknown',/Unknown/]]) {
  const ctx={ptcRuntime:{language:'typescript'},get:name=>name==='ultracodeState'?{requiresWorkflow:()=>true}:name==='nestedSessions'?{delegationMode:()=>preference,startWorkflowChild:()=>{throw Error('must not activate');}}:undefined};
  const engine=new Engine(ctx,{});
  assert.throws(()=>engine.start({meta:{},script:'return 1',parent,workerMode}),pattern);
 }
});
