const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {withAgentTestHomeLock}=require('./test-home.cjs');

async function main() {
  const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
  assert(process.env.OPENAI_API_KEY&&native);
  const output=path.join(home,'linked-lifecycle-'+Date.now());fs.mkdirSync(output,{recursive:true});
  const patch=path.join(output,'runtime.patch.json');
  fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
  const nativePatch=path.join(output,'native-read.patch.json');
  fs.writeFileSync(nativePatch,JSON.stringify([{id:'nested-sessions',disabled:true},{id:'ultracode',disabled:true}]));
  const boot=(nativeRead=false)=>runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch,...(nativeRead?[nativePatch]:[])],args:['--port','0','--no-open']});
  const reports=[];
  let host=await boot();
  try {
    const ctx=host.ctx;
    const linked=await new Promise(resolve=>ctx.inject(['nestedSessions'],scope=>resolve(scope.nestedSessions)));
    for(const preset of ['standard','ptc']) {
      const cwd=path.join(output,preset);fs.mkdirSync(cwd,{recursive:true});
      const file=path.join(cwd,'counter.txt');fs.writeFileSync(file,'0');
      const workspace=await ctx.workspaceRegistry.create(cwd,'Linked lifecycle '+preset);
      const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
      const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);
      ctx.permissionPresets.set(agent.session,'workspace-write');
      for(const command of ['/ultracode on','/collaborate on'])
        assert.equal((await ctx.commands.execute(agent,command,[],AbortSignal.timeout(30000))).result.kind,'success');
      let enter;
      const entered=new Promise(resolve=>{enter=resolve;});
      const release=ctx.on('tools/execute',async(exec,next)=>{
        if(exec.name==='write'&&path.resolve(ctx.workingDirectory.get(exec.agent.session),exec.arguments.file_path)===file) {
          enter();
          await new Promise(resolve=>exec.signal.aborted?resolve():exec.signal.addEventListener('abort',resolve,{once:true}));
        }
        return next();
      });
      const args={worker_mode:'linked',...(preset==='ptc'?{}:{run_in_background:true}),meta:{name:'linked-stop',description:'One retained worker'},
        script:'return await agent('+JSON.stringify('Read '+file+' and increment it once using the write tool. No shell, memory, delegation or other files. Return the resulting value.')+');',args:{}};
      const text='生命周期验收：仅调用一次 workflow，参数如下，错误或取消后报告并停止，不重试也不改用其他工具。PTC 使用 console.log(await tools.workflow(JSON对象));。\n'+JSON.stringify(args);
      await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]},AbortSignal.timeout(180000));
      let timer;
      await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Linked write was not reached')),180000);})]).finally(()=>clearTimeout(timer));
      const runId=agent.session.snapshotEvents().findLast(event=>event.type==='tool-workflow/run-start')?.data.runId;assert(runId);
      const stopped=await ctx.commands.execute(agent,'/workflow stop '+runId,[],AbortSignal.timeout(120000));
      assert.equal(stopped.result.kind,'success',JSON.stringify(stopped));
      await agent.whenIdle();release();
      assert.equal(fs.readFileSync(file,'utf8'),'0');
      const family=(await linked.list({sessionId:agent.id})).links;
      assert.equal(family.length,1);assert.equal(family[0].status,'stopped');assert.equal(family[0].wakeParent,false);
      assert.equal((await ctx.commands.execute(agent,'/workflow continue',[],AbortSignal.timeout(30000))).result.kind,'error');
      assert.equal((await ctx.commands.execute(agent,'/workflow resume '+runId,[],AbortSignal.timeout(30000))).result.kind,'error');
      assert.equal(agent.session.snapshotEvents().filter(event=>event.type==='tool-workflow/run-start').length,1);
      reports.push({preset,sessionId:agent.id,childId:family[0].sessionId,runId,file});
      console.log('LINKED_STOP_CASE_PASS '+preset);
    }
  } finally {await host.shutdown.shutdown(0);}
  host=await boot();
  try {
    for(const report of reports) {
      const {agent}=await host.ctx.sessionController.resolveAgent(report.sessionId);
      assert.equal((await host.ctx.commands.execute(agent,'/workflow continue',[],AbortSignal.timeout(30000))).result.kind,'error');
      assert.equal(fs.readFileSync(report.file,'utf8'),'0');
      const history=await host.ctx.sessionController.inspect(report.childId);
      assert(history.events.some(event=>event.type==='turn/end'));
    }
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(reports,null,2));
    console.log('LINKED_COLD_PASS stopped runs and retained histories survive restart');
  } finally {await host.shutdown.shutdown(0);}
  host=await boot(true);
  try {
    assert.equal(host.ctx.get('nestedSessions'),undefined);
    assert.equal(host.ctx.get('ultracodeState'),undefined);
    for(const report of reports) {
      const child=await host.ctx.sessionController.inspect(report.childId);
      const parent=await host.ctx.sessionController.inspect(report.sessionId);
      assert(child.events.some(event=>event.type==='turn/end'));
      assert(parent.events.some(event=>event.type==='tool-workflow/run-start'));
    }
    console.log('LINKED_WORKFLOW_LIFECYCLE_PASS Standard/PTC stop joins retained workers, blocks restart and native persistence reads history with plugins disabled');
  } finally {await host.shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
