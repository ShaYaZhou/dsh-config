const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {assertIsolatedHome,withAgentTestHomeLock} = require('./test-home.cjs');
const {withOutputLock} = require('./test-output-lock.cjs');

const output = path.resolve(__dirname, '../.local/idle-compaction-test');
async function verifyBindings(ctx, project) {
  const engines=new Set(), roles=[];
  for(const role of ['standard','explore','planner','reviewer']) {
    const created=await ctx.sessionController.create({cwd:project,agentPreset:role});
    const agent=(await ctx.sessionController.resolveAgent(created.sessionId)).agent;
    const binding=ctx.localIdleCompaction.forAgent(agent);
    assert(binding,`No native compaction engine for ${role}`);
    engines.add(binding.engine);roles.push(role);
  }
  assert.equal(engines.size,roles.length,'Different role compositions must not share an isolated engine');
  return {roles,distinctEngines:engines.size};
}
async function verify() {
  for (const file of ['result.json', 'failure.json']) fs.rmSync(path.join(output, file), {force:true});
  const progress = (phase, details={}) => fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({phase,...details}));
  const overlay = path.join(output, 'runtime.patch.yml');
  const native = process.env.DSH_NATIVE_ROOT;
  const {runProfile} = await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
  let runtime,ctx,agent,originalEnabled,lastEnabled,result;
  const descriptor=()=>ctx.settings.describe().find(row=>row.ns==='idle-compaction');
  const open = async (shortInterval=false) => {
    if(runtime){await runtime.shutdown.shutdown(0);runtime=undefined;}
    fs.writeFileSync(overlay,JSON.stringify([
      {id:'desktop-product-telemetry',disabled:true},
      {id:'product-analytics',disabled:true},
      {id:'dsh-memory',disabled:true},
      ...(shortInterval ? [{id:'idle-compaction',config:{idleMs:60000,minTokens:200000,enabled:lastEnabled}}] : []),
    ]));
    runtime=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[overlay],args:['--port','0','--no-open']});ctx=runtime.ctx;
    ctx.on('session/event',(session,event)=>{
      if(session.id===agent?.id && ['compaction/start','compaction/summary','compaction/end'].includes(event.type))
        progress(event.type,{sessionId:agent.id,...event.data.error ? {error:event.data.error} : {}});
    });
  };
  const started=Date.now(), signal=AbortSignal.timeout(600000);
  const wait=async(predicate,timeoutMs)=>{
    const end=Date.now()+timeoutMs;
    while(!predicate()) {
      signal.throwIfAborted();assert(Date.now()<end,'Timed out waiting for native idle maintenance');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  };
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    await open();
    originalEnabled=descriptor()?.value.enabled;
    lastEnabled=originalEnabled;
    progress('booted');
    const project=path.join(output,'project');fs.mkdirSync(project,{recursive:true});
    fs.writeFileSync(path.join(project,'AGENTS.md'),'Synthetic idle-compaction fixture. Do not use tools, access the network, write memory or change project files.');
    const bindings=await verifyBindings(ctx,project);
    let created;
    if(process.env.DSH_IDLE_SESSION) {
      const observed=await ctx.sessionController.inspect(process.env.DSH_IDLE_SESSION);
      const compactIndex=observed.events.findIndex(event=>event.type==='compaction/start');
      const boundary=compactIndex<0 ? undefined : observed.events.slice(0,compactIndex).findLast(event=>event.type==='turn/end')?.seq;
      assert.equal(path.resolve(observed.meta.cwd),project,'Only this synthetic project can be forked');
      created=boundary===undefined ? {sessionId:process.env.DSH_IDLE_SESSION} : await ctx.sessionController.fork({sessionId:process.env.DSH_IDLE_SESSION,atSeq:boundary});
    } else created=await ctx.sessionController.create({cwd:project});
    agent=(await ctx.sessionController.resolveAgent(created.sessionId)).agent;
    assert(ctx.localIdleCompaction.forAgent(agent),'The selected Agent composition did not bind its native compaction engine');
    assert.equal(path.resolve(agent.session.header.cwd),project,'Only this synthetic project can be resumed');
    const seeded=process.env.DSH_IDLE_SESSION ? agent.session.snapshotEvents().find(event=>event.type==='user/message') : null;
    const key=seeded ? seeded.data.content.find(block=>block.type==='text')?.text.match(/verification code is (ORCHID-[a-f0-9]{8})/)?.[1] : 'ORCHID-'+randomUUID().slice(0,8);
    assert(key,'No verification code in the synthetic seed');
    const text=`Task context: the verification code is ${key}. Preserve it for the next question. No publishing or pushing is authorized.\n`+
      Array(12000).fill('Historical note: synthetic calibration values are repetitive background and carry no additional task requirements.').join('\n')+
      `\nThe only durable fact to retain is verification code ${key}. Reply exactly IDLE_READY. Do not use tools or store memory.`;
    progress(seeded?'using-existing-context':'seeding-context',{sessionId:agent.id,characters:text.length});
    if(!seeded) await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]},signal);
    await agent.whenIdle();
    const tokens=ctx.tokenMeter.measure(agent.session).totalTokens;
    assert(tokens>=200000,`Fixture below the real 200K eligibility threshold: ${tokens}`);
    const summaries=()=>agent.session.snapshotEvents().filter(event=>event.type==='compaction/summary');
    assert.equal(summaries().length,0,'Pressure compaction ran before the idle test');
    assert(descriptor()?.autoGenerate,'Native settings did not expose the idle maintenance switch');
    await ctx.settings.update('idle-compaction',{enabled:false},descriptor().revision);
    assert.equal(descriptor().value.enabled,false);
    lastEnabled=false;
    await open(true);agent=(await ctx.sessionController.resolveAgent(created.sessionId)).agent;
    assert.equal(descriptor().value.enabled,false);
    progress('switch-off-wait',{sessionId:agent.id,tokens});
    await new Promise(resolve=>setTimeout(resolve,65000));signal.throwIfAborted();
    assert.equal(summaries().length,0,'Disabled idle maintenance still summarized');
    await open();
    assert.equal(descriptor().value.enabled,false,'The native off switch did not persist across normal boots');
    await ctx.settings.update('idle-compaction',{enabled:true},descriptor().revision);
    assert.equal(descriptor().value.enabled,true);
    lastEnabled=true;
    await open(true);agent=(await ctx.sessionController.resolveAgent(created.sessionId)).agent;
    const prior=agent.session.snapshotEvents(), original=digest(prior);
    progress('switch-on-wait',{sessionId:agent.id,tokens});
    await wait(()=>summaries().length>0,150000);
    await wait(()=>agent.session.snapshotEvents().some(event=>event.type==='compaction/end'),120000);
    const after=agent.session.snapshotEvents(), summary=summaries().at(-1), end=after.findLast(event=>event.type==='compaction/end');
    assert(!end.data.error,end.data.error);
    assert(summary.data.llmStreamCall,'Summary did not use the native LLM seam');
    assert.equal(digest(after.slice(0,prior.length)),original,'Compaction rewrote original history');
    assert(summary.data.shadowedSeqs.length>0,'No real history was summarized');
    assert(summary.data.shadowedSeqs.some(seq=>!agent.session.surface.nodes.includes(seq)),'No active context was replaced');
    const replacement=after.find(event=>event.type==='user/message' && event.data.source?.kind==='compact-checkpoint');
    assert(replacement,'No durable native checkpoint');
    progress('resuming-after-summary',{sessionId:agent.id});
    await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'What is the verification code from the task context? Reply with that code only. Do not use tools or memory.'}]},signal);
    await agent.whenIdle();
    const reply=agent.session.snapshotEvents().filter(event=>event.type==='assistant/message').at(-1)?.data;
    const response=(reply?.message ?? reply)?.content?.filter(block=>block.type==='text').map(block=>block.text).join('\n');
    assert(response?.includes(key),'The resumed model did not retain the verification code');
    await ctx.sessions.flush(agent.session);
    const archiveFork=await ctx.sessionController.fork({sessionId:agent.id,atSeq:prior.findLast(event=>event.type==='turn/end').seq});
    const worker=(await ctx.sessionController.resolveAgent(archiveFork.sessionId)).agent;
    const engine=ctx.localIdleCompaction.forAgent(worker).engine, summarize=engine.summarize;
    let heldSignal;
    try {
      engine.summarize=async(_input,_owner,abort)=>{heldSignal=abort;abort.throwIfAborted();await new Promise((_resolve,reject)=>abort.addEventListener('abort',()=>reject(abort.reason),{once:true}));};
      progress('archive-during-maintenance',{sessionId:worker.id});
      await wait(()=>!!heldSignal,120000);
      await assert.rejects(ctx.workspaceRegistry.archiveSession(worker.id));
      await ctx.workspaceRegistry.archiveSession(worker.id,{stopActivity:true});
      assert(heldSignal.aborted,'Archive did not cancel in-flight maintenance');
      await worker.whenIdle();
      assert.equal(worker.session.snapshotEvents().filter(event=>event.type==='compaction/summary').length,0,'Archived maintenance committed a summary');
      assert(worker.session.snapshotEvents().findLast(event=>event.type==='compaction/end')?.data.error,'Cancelled maintenance had no durable outcome');
    } finally {engine.summarize=summarize;}
    result={passed:true,sessionId:agent.id,measuredTokens:tokens,configuredIdleMs:60000,productionDefaultIdleMs:3240000,offSwitchPreventedSummary:true,nativeSettings:true,realLlmSummary:true,historyUnchanged:true,checkpointCommitted:true,resumeRetainedFact:true,archiveCancelledMaintenance:true,bindings,elapsedSeconds:Math.round((Date.now()-started)/1000)};
  } catch(error) {
    fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,sessionId:agent?.id},null,2));throw error;
  } finally {
    const restore=typeof originalEnabled==='boolean' && lastEnabled!==originalEnabled;
    if(runtime){for(const current of ctx.agents.list())if(current.status==='running')current.cancel({kind:'user'},{keepInbox:false});await runtime.shutdown.shutdown(0);runtime=undefined;}
    if(restore){await open();await ctx.settings.update('idle-compaction',{enabled:originalEnabled},descriptor().revision);await runtime.shutdown.shutdown(0);runtime=undefined;}
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  progress('passed',result);console.log('IDLE_COMPACTION_PASS '+JSON.stringify(result));
}
async function main() {
  assert(process.env.OPENAI_API_KEY && process.env.DSH_HOME && process.env.DSH_NATIVE_ROOT, 'Use idle-test with an isolated home and a configured proxy');
  assertIsolatedHome(process.env.DSH_HOME);
  await verify();
}
module.exports={verifyBindings};
if(require.main===module) withOutputLock(output,()=>withAgentTestHomeLock(process.env.DSH_HOME,main)).catch(error=>{console.error(error.stack);process.exitCode=1;});
