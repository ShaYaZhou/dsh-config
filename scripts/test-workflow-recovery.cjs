const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {withAgentTestHomeLock}=require('./test-home.cjs');

async function main(){
  const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
  assert(process.env.OPENAI_API_KEY && native);
  const output=path.join(home,'recovery-acceptance');fs.mkdirSync(output,{recursive:true});
  const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
  const patch=path.join(output,'runtime.patch.json');fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const reports=[];
  const resultFile=path.join(output,'result.json');
  if(process.env.DSH_RECOVERY_COLD_ONLY!=='1' && fs.existsSync(resultFile))fs.unlinkSync(resultFile);
  async function boot(){return runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});}
  if(process.env.DSH_RECOVERY_COLD_ONLY==='1') {
    const saved=JSON.parse(fs.readFileSync(resultFile,'utf8'));assert.equal(saved.length,2);
    const host=await boot(),ctx=host.ctx;
    try {
      for(const row of saved) {
        const header=id=>{assert(/^[0-9a-f-]{36}$/i.test(id));return JSON.parse(fs.readFileSync(path.join(home,'workflows/runs',id+'.jsonl'),'utf8').split('\n')[0]);};
        const {agent}=await ctx.sessionController.resolveAgent(header(row.cold).identity.owner);
        const command=await ctx.commands.execute(agent,'/workflow resume '+row.cold,[],AbortSignal.timeout(120000));
        assert.equal(command.result.kind,'success',JSON.stringify(command));await agent.whenIdle();
        row.cold=agent.session.snapshotEvents().findLast(e=>e.type==='tool-workflow/run-start').data.runId;
        const {agent:stoppedAgent}=await ctx.sessionController.resolveAgent(header(row.stopped).identity.owner);
        const blocked=await ctx.commands.execute(stoppedAgent,'/workflow continue',[],AbortSignal.timeout(30000));assert.equal(blocked.result.kind,'error');
        const refused=await ctx.commands.execute(stoppedAgent,'/workflow resume '+row.stopped,[],AbortSignal.timeout(30000));assert.equal(refused.result.kind,'error');
        for(const [name,value]of [['first.txt','1'],['second.txt','1'],['uncertain.txt','1'],['stopped.txt','0']])
          assert.equal(fs.readFileSync(path.join(output,row.preset,name),'utf8').trim(),value);
      }
      fs.writeFileSync(resultFile,JSON.stringify(saved,null,2));
      console.log('WORKFLOW_RECOVERY_COLD_PASS final installed engine replayed both modes without writes and refused stopped/uncertain work');
    } finally {await host.shutdown.shutdown(0);}
    return;
  }
  for(const preset of ['standard','ptc']){
    fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({preset,phase:'boot'}));
    let host=await boot();
    let ctx=host.ctx;
    const cwd=path.join(output,preset);fs.mkdirSync(cwd,{recursive:true});
    fs.writeFileSync(path.join(cwd,'AGENTS.md'),'Synthetic lifecycle acceptance. Use only read/write tools (wrapped in run_code in PTC) for the supplied counter files. No shell, network, memory, other projects, or extra delegation. A workflow parent may use workflow and report its outcome. Do not retry refused or failed operations.');
    const a=path.join(cwd,'first.txt'),b=path.join(cwd,'second.txt'),stopped=path.join(cwd,'stopped.txt');
    for(const file of [a,b,stopped])fs.writeFileSync(file,'0');
    const increment=file=>`Read ${file}, parse its integer, then write that integer plus one to the SAME file exactly once with the write tool. Do not use bash or raw filesystem APIs. Return the resulting integer. Do not retry or delegate.`;
    const script=`const a=await agent(${JSON.stringify(increment(a))}); const b=await agent(${JSON.stringify(increment(b))}); return {a,b};`;
    const args={budget_ms:180000,meta:{name:'recover-two-writes',description:'Synthetic counter recovery'},script,args:{}};
    let parent;
    const lastRun=agent=>agent.session.snapshotEvents().findLast(e=>e.type==='tool-workflow/run-start')?.data.runId;
    const command=async(agent,text)=>ctx.commands.execute(agent,text,[],AbortSignal.timeout(120000));
    const prompt=async(agent,request)=>{
      fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({preset,phase:request.meta.name,sessionId:agent.id}));
      await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'Lifecycle acceptance. Call workflow exactly once with the following arguments, unchanged (PTC: tools.workflow inside run_code). On error, report its run ID and STOP. Do not attempt repairs, retries, other tools, or new workflows.\n'+JSON.stringify(request)}]},AbortSignal.timeout(180000));
      await agent.whenIdle();
    };
    try{
      const workspace=await ctx.workspaceRegistry.create(cwd,'Recovery '+preset);
      const create=async()=>{
        const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
        const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);ctx.permissionPresets.set(agent.session,'workspace-write');return agent;
      };
      parent=await create();
      const runtime=ctx.ptcRuntime,resolve=runtime.resolve.bind(runtime);
      let injected=false;
      runtime.resolve=input=>resolve({...input,bindings:input.bindings?.map(binding=>binding.global!=='workflowHost'?binding:{...binding,functions:{...binding.functions,startChild:async request=>{
        if(request.seq===2 && !injected){injected=true;throw new Error('SYNTHETIC_PRE_ADMISSION_FAILURE');}
        return binding.functions.startChild(request);
      }}})});
      await prompt(parent,args);
      runtime.resolve=resolve;
      assert(injected,'Fault was not exercised');
      const first=lastRun(parent);assert(first);
      assert.equal(fs.readFileSync(a,'utf8').trim(),'1');assert.equal(fs.readFileSync(b,'utf8').trim(),'0');
      await prompt(parent,args);
      assert.equal(lastRun(parent),first,'Failure must not silently restart');
      assert.equal(fs.readFileSync(a,'utf8').trim(),'1');
      assert.equal(fs.readFileSync(b,'utf8').trim(),'0');
      const accepted=await command(parent,'/workflow resume '+first);assert.equal(accepted.result.kind,'success',JSON.stringify(accepted));
      await parent.whenIdle();
      const resumed=lastRun(parent);assert(resumed && resumed!==first);
      assert.equal(fs.readFileSync(a,'utf8').trim(),'1','Completed write replayed twice');
      assert.equal(fs.readFileSync(b,'utf8').trim(),'1');
      assert.equal((await command(parent,'/workflow resume '+first)).result.kind,'error');
      const uncertainParent=await create();
      const uncertainFile=path.join(cwd,'uncertain.txt');fs.writeFileSync(uncertainFile,'0');
      const subagents=ctx.subagents,startActivation=subagents.startActivation.bind(subagents);
      let attempts=0;
      subagents.startActivation=async options=>{
        const activation=await startActivation(options);
        if(options.request?.parent?.id!==uncertainParent.id)return activation;
        attempts++;
        return {...activation,result:activation.result.then(value=>({...value,structured:undefined})),dispose:()=>activation.dispose()};
      };
      const uncertainArgs={meta:{name:'lost-structured-write',description:'Missing structured result after a real write'},script:`return await agent(${JSON.stringify(increment(uncertainFile))},{schema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}});`,args:{}};
      await prompt(uncertainParent,uncertainArgs);
      subagents.startActivation=startActivation;
      assert.equal(attempts,1,'A writable schema retry repeated its side effects');
      assert.equal(fs.readFileSync(uncertainFile,'utf8').trim(),'1');
      const uncertainId=lastRun(uncertainParent);assert(uncertainId);
      const refusal=await command(uncertainParent,'/workflow resume '+uncertainId);
      assert.equal(refusal.result.kind,'error');
      assert.equal(fs.readFileSync(uncertainFile,'utf8').trim(),'1');
      const stopParent=await create();
      let enter;
      const entered=new Promise(resolve=>enter=resolve);
      const remove=ctx.on('tools/execute',async(exec,next)=>{
        if(exec.name==='write' && path.resolve(ctx.workingDirectory.get(exec.agent.session),exec.arguments.file_path)===stopped){
          enter();
          await new Promise(resolve=>exec.signal.aborted?resolve():exec.signal.addEventListener('abort',resolve,{once:true}));
        }
        return next();
      });
      const stopArgs={run_in_background:true,meta:{name:'stop-pending-write',description:'Stop before a synthetic write'},script:`return await agent(${JSON.stringify(increment(stopped))});`,args:{}};
      const pending=prompt(stopParent,stopArgs);
      let timer;
      await Promise.race([entered,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Stop probe did not reach write')),180000))]).finally(()=>clearTimeout(timer));
      const stopId=lastRun(stopParent);assert(stopId);
      const result=await command(stopParent,'/workflow stop '+stopId);assert.equal(result.result.kind,'success',JSON.stringify(result));
      await pending;remove();
      assert.equal(fs.readFileSync(stopped,'utf8'),'0','Write occurred after stop');
      await prompt(stopParent,stopArgs);
      assert.equal(lastRun(stopParent),stopId);
      assert.equal(fs.readFileSync(stopped,'utf8'),'0');
      const uncertain=await command(stopParent,'/workflow resume '+stopId);assert.equal(uncertain.result.kind,'error');
      const parentId=parent.id,stopParentId=stopParent.id;
      await host.shutdown.shutdown(0);
      host=await boot();ctx=host.ctx;
      parent=(await ctx.sessionController.resolveAgent(parentId)).agent;
      const coldStopped=(await ctx.sessionController.resolveAgent(stopParentId)).agent;
      await prompt(coldStopped,stopArgs);
      assert.equal(lastRun(coldStopped),stopId,'Stop latch did not survive restart');
      const cold=await command(parent,'/workflow resume '+resumed);assert.equal(cold.result.kind,'success',JSON.stringify(cold));
      await parent.whenIdle();
      assert.equal(fs.readFileSync(a,'utf8').trim(),'1');assert.equal(fs.readFileSync(b,'utf8').trim(),'1');assert.equal(fs.readFileSync(stopped,'utf8'),'0');
      assert.equal(ctx.permissionPresets.current(parent.session),'workspace-write');
      reports.push({preset,first,resumed,cold:lastRun(parent),stopped:stopId,counters:[1,1,0]});
      fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(reports,null,2));
      console.log('RECOVERY_CASE_PASS '+preset+' counters=1,1,0; cold replay and stop latch verified');
    }finally{await host.shutdown.shutdown(0);}
  }
  console.log('WORKFLOW_RECOVERY_PASS Standard and PTC real-model failure, stop, resume and cold acceptance');
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
