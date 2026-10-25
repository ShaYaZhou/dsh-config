import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {relative,isAbsolute,sep} from 'node:path';
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

function runtimeFixture({unsettled=false,cleanupFailure=false,sandboxMode=true}={}) {
  const source=fs.readFileSync(new URL('../plugins/workflow-ptc/lib/index.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('var PtcWorkflowRun = class'),source.indexOf('import { realpathSync }'));
  const Run=vm.runInNewContext(code+';PtcWorkflowRun',{AbortController,Promise,relative,isAbsolute,sep,process,realpathSync:x=>x,PROGRAM:'fixture',json:x=>x,workflowResult:x=>x,renderThrown:String});
  const ends=[],guards=[],stops=[],resolved=[];
  const run=new Run({workingDirectory:{ensure:()=>Promise.resolve('/fixture')},logger:{warn:()=>{}}},{},{sandboxMode:sandboxMode || undefined,resolve:x=>{resolved.push(x);return x;},run:async()=>({value:{value:null,stopReason:'completed',agentsStarted:0}})},'run',{}, {session:{id:'owner'}},{},'spawn',{mode:'workspace-write'},{agentEnd:()=>{}},{cwd:'/fixture',journal:{hasUnsettled:unsettled,finish:r=>ends.push(r)},stopOwner:()=>stops.push(true),onChildActive:(_id,active)=>guards.push(active)});
  if(cleanupFailure)run.children.set(1,{callId:1,run:{childId:'child',dispose:async()=>{throw new Error('provider cleanup failed');}}});
  return {run,ends,guards,stops,resolved};
}
test('orchestration process is read-only without narrowing admitted child permissions',async()=>{
 const f=runtimeFixture();await f.run.result;
 assert.equal(f.resolved[0].sandboxPolicy.mode,'read-only');
 assert.equal(f.run.policy.mode,'workspace-write');
 const unsafe=runtimeFixture({sandboxMode:false});const result=await unsafe.run.result;
 assert.equal(result.stopReason,'error');assert.match(result.error,/read-only orchestration/);
 assert.equal(unsafe.resolved.length,0);
});
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

test('failed writable results keep their directory occupied until the script settles',async()=>{
 const f=runtimeFixture();let settle,releases=0;
 const pending=new Promise(resolve=>{settle=resolve;});
 f.run.runtime.run=async()=>{await pending;return {value:{value:null,stopReason:'completed',agentsStarted:1}};};
 f.run.ctx.get=()=>undefined;
 f.run.deps.journal.recordResult=()=>{};
 const access={cwd:'/fixture',readOnly:false};
 const native={childId:'failed-writer',result:Promise.resolve({output:[],stopReason:'error'}),dispose:async()=>{}};
 const run=await f.run.activate(request,1,{plan:{cwd:'/fixture',mode:'linked',access,linked:{startWorkflowChild:async()=>native}},release:()=>{releases++;}});
 const record={callId:1,seq:1,request,run};f.run.children.set(1,record);
 const payload=await f.run.childResult(record);assert.equal(payload.stopReason,'error');assert.equal(run.uncertainWrites,true);
 await f.run.disposeChild(record);
 assert.equal(releases,0,'Failed writer released its root before the script finished');
 assert.equal(f.run.failedWriteLeases.size,1);
 settle();await f.run.result;assert.equal(releases,1);
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
 for(const [preference,workerMode,pattern] of [['off','linked',/disabled/],['worker','linked',/disabled/],['auto','unknown',/Unknown/]]) {
  const ctx={ptcRuntime:{language:'typescript'},get:name=>name==='ultracodeState'?{requiresWorkflow:()=>true}:name==='nestedSessions'?{delegationMode:()=>preference,startWorkflowChild:()=>{throw Error('must not activate');}}:undefined};
  const engine=new Engine(ctx,{});
  assert.throws(()=>engine.start({meta:{},script:'return 1',parent,workerMode}),pattern);
 }
});

function resourceEngine() {
 const source=fs.readFileSync(new URL('../plugins/workflow-ptc/lib/index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('var PtcWorkflowEngine = class'),source.indexOf('var index_default = PtcWorkflowEngine'));
 const schema=new Proxy(()=>{}, {get:()=>schema,apply:()=>schema});
 const Engine=vm.runInNewContext(code+';PtcWorkflowEngine',{WorkflowEngine:class {constructor(ctx){this.ctx=ctx;}},z:schema,relative,isAbsolute,sep});
 return new Engine({ptcRuntime:{language:'typescript'}},{});
}
test('workflow admission allows isolated writers and readers, rejects only overlapping writes or browser owners',()=>{
 const engine=resourceEngine();
 const a={cwd:'/fixture/trees/a',readOnly:false,browser:false};
 const b={cwd:'/fixture/trees/b',readOnly:false,browser:false};
 const releaseA=engine.claim(a), releaseB=engine.claim(b);
 assert.equal(engine.resourceClaims.size,2);
 const other=new engine.constructor({ptcRuntime:{language:'typescript'}},{});
 assert.throws(()=>other.claim({...a}),/resource conflict/,'Other workflow scopes share the same resource admission');
 const releaseRead=engine.claim({cwd:'/fixture',readOnly:true,browser:false});
 assert.throws(()=>engine.claim({cwd:'/fixture/trees/a/..cache',readOnly:false,browser:false}),/resource conflict/);
 assert.throws(()=>engine.claim({cwd:'/fixture/trees/a/src',readOnly:false,browser:false}),/resource conflict/);
 assert.throws(()=>engine.claim({cwd:'/fixture',readOnly:false,browser:false}),/resource conflict/);
 releaseA();assert.equal(a.active,false);
 const nextA=engine.claim({cwd:'/fixture/trees/a',readOnly:false,browser:false});
 const releaseBrowser=engine.claim({cwd:'/fixture',readOnly:true,browser:true});
 assert.throws(()=>engine.claim({cwd:'/elsewhere',readOnly:true,browser:true}),/resource conflict/);
 releaseB();releaseRead();nextA();releaseBrowser();assert.equal(engine.resourceClaims.size,0);
});
test('recovery binds worker directory, readonly mode, persistence and browser claim',t=>{
 for(const field of ['cwd','read_only','session','browser','reasoning_effort']) {
  const {create}=fixture(t);const a=create();
  const req={...request,cwd:'/fixture/tree',read_only:true,session:'subagent',browser:false,reasoning_effort:'medium'};
  a.j.recordIntent(req,'spawn');a.j.recordCall(req,'spawn','child');a.j.recordResult(1,{output:[],stopReason:'completed'});a.j.finish({stopReason:'completed'});
  const b=create(header,a.id);assert.throws(()=>b.j.takeReplay({...req,[field]:field==='cwd'?'/elsewhere':field==='session'?'linked':field==='reasoning_effort'?'high':!req[field]},'spawn'),/changed/);b.j.finish({stopReason:'error'});
 }
});

test('unconfined providers are refused before activation',async()=>{
 const f=runtimeFixture();
 f.run.parent.session.header={cwd:'/fixture'};
 f.run.deps.workerMode='subagent';
 f.run.subagents.getProvider=()=>({});
 await assert.rejects(f.run.planChild({seq:1,prompt:'read fixture'}),/native child creation boundary/);
 await f.run.result;
});

test('unknown-duration PTC workflows use native jobs without raising transport limits',()=>{
 const source=fs.readFileSync(new URL('../plugins/tool-workflow/lib/index.js',import.meta.url),'utf8');
 const start=source.indexOf('function wantsBackground(');
 const end=source.indexOf('function startBackgroundRun(',start);
 const select=vm.runInNewContext(source.slice(start,end)+';wantsBackground');
 assert.equal(select({},'ptc',true),true);
 assert.equal(select({budget_ms:180000},'ptc',true),true,'A dispatch budget does not bound an active child');
 assert.equal(select({run_in_background:false},'ptc',true),false);
 assert.equal(select({},'native',true),false);
 assert.equal(select({},'ptc',false),false);
 assert.equal(select({run_in_background:true},'native',false),true);
});
