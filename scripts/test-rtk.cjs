const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {withAgentTestHomeLock}=require('./test-home.cjs');
async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 const output=path.join(home,'rtk-validation');fs.mkdirSync(output,{recursive:true});
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-rtk-'));
 assert.equal(spawnSync('git',['init','--quiet',cwd]).status,0);
 assert.equal(spawnSync('git',['-C',cwd,'-c','user.name=RTK Fixture','-c','user.email=rtk@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture']).status,0);
 fs.writeFileSync(path.join(cwd,'rtk-fixture.txt'),'fixture');
 const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
 const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
 const patch=path.join(output,'patch.json');fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const runtime=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 const ctx=runtime.ctx,calls=[],reports=[];
 ctx.on('tools/result',(exec,result)=>calls.push({agent:exec.agent?.id,name:exec.name,args:exec.arguments,result}));
 try{
  const workspace=await ctx.workspaceRegistry.create(cwd,'RTK validation');
  for(const preset of ['standard','ptc']){
   const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
   const agent=(await ctx.sessionController.resolveAgent(made.sessionId)).agent;
   ctx.permissionPresets.set(agent.session,'workspace-write');
   const started=Date.now();
   await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'Use the shell tool to inspect this repository git status and last three log entries, then summarize. Do not change files or delegate. Follow your installed global instructions.'}]},AbortSignal.timeout(120000));
   await Promise.race([agent.whenIdle(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('RTK model timeout')),120000);timer.unref();})]);
   const shell=calls.filter(c=>c.agent===agent.id&&['bash','pwsh'].includes(c.name));
   fs.writeFileSync(path.join(output,preset+'.json'),JSON.stringify(shell,null,2));
   assert(shell.some(c=>/rtk\s+git\s+status/.test(JSON.stringify(c.args))&&c.result.value?.exitCode===0),preset+' did not successfully use RTK');
   assert(shell.filter(c=>/rtk\s+git/.test(JSON.stringify(c.args))).every(c=>c.result.value?.sandbox?.enforcement==='full'));
   assert(!shell.some(c=>/command not found|rtk: not found/.test(JSON.stringify(c.result))),preset+' RTK unavailable');
   assert.equal(ctx.permissionPresets.current(agent.session),'workspace-write');
   assert.equal(fs.readFileSync(path.join(cwd,'rtk-fixture.txt'),'utf8'),'fixture');
   reports.push({preset,rtkUsed:true,shellCalls:shell.length,elapsedSeconds:(Date.now()-started)/1000});
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(reports,null,2));
  console.log('RTK_MODEL_PASS '+JSON.stringify(reports));
 }finally{
  for(const agent of ctx.agents.list())if(agent.status==='running')agent.cancel({kind:'user'},{keepInbox:false});
  await runtime.shutdown.shutdown(0);
 }
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
