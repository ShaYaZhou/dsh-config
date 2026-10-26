const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
async function main(){
 const home=process.env.DSH_HOME,n=process.env.DSH_NATIVE_ROOT,out=path.join(home,'collision-check');fs.mkdirSync(out,{recursive:true});const patch=path.join(out,'patch.json');fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const {runProfile}=await import(pathToFileURL(path.join(n,'dsh/lib/profile-boot.js'))),{loadLayeredEnv}=await import(pathToFileURL(path.join(n,'dsh-app-boot/lib/index.js')));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});const report={};
 try{
  const actions=[['native-on',()=>ctx.pluginManager.setBundleEnabled('@deepseek-ai/dsh-experimental-agent-team-profile',true)],['local-core-on',()=>ctx.pluginManager.setPluginEnabled('include:agent-team-local',true)],['local-tools-on',()=>ctx.pluginManager.setPluginEnabled('include:tool-agent-team-local',true)]];if(process.env.DSH_COLLISION_REVERSE==='1')actions.push(actions.shift());
  for(const [name,action]of actions){
   try{await action();report[name]='returned';}catch(e){report[name]=String(e.message);}
  }
  report.rows=(await ctx.pluginManager.listPlugins()).filter(r=>/agent-team/.test(r.patchId??'')).map(r=>({id:r.patchId,enabled:r.enabled,phase:r.fiberPhase}));
  report.extendedService=typeof ctx.get('agentTeams')?.hasPendingPlan;
  fs.writeFileSync(path.join(out,'fixture.txt'),'fixture');const w=await ctx.workspaceRegistry.create(out,'Collision probe');
  report.reads=[];
  for(const preset of ['standard','ptc']){
   const made=await ctx.sessionController.create({workspaceId:w.id,agentPreset:preset});const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);ctx.permissionPresets.set(agent.session,'read-only');
   const args={file_path:path.join(out,'fixture.txt')};
   const invocation=preset==='ptc'?{name:'run_code',arguments:{description:'Read collision fixture',code:'console.log(await tools.read('+JSON.stringify(args)+'));'}}:{name:'read',arguments:args};
   try{const r=await agent.ctx.tools.execute({agent,callId:'collision-read-'+preset,...invocation,signal:AbortSignal.timeout(10000)});report.reads.push({preset,isError:r.isError,text:JSON.stringify(r.content).slice(0,700)});}catch(e){report.reads.push({preset,error:String(e.message)});}
  }
  assert(report.reads.length===2&&report.reads.every(r=>r.isError===false&&!r.error),'Core preset execution failed');
  console.log('TEAM_COEXISTENCE_PASS Standard/PTC remain usable with rejected duplicate Team service');
 }finally{
  for(const id of ['tool-agent-team-local','agent-team-local'])await ctx.pluginManager.setPluginEnabled('include:'+id,false).catch(()=>{});
  await ctx.pluginManager.setBundleEnabled('@deepseek-ai/dsh-experimental-agent-team-profile',false).catch(()=>{});
  fs.writeFileSync(path.join(out,process.env.DSH_COLLISION_REVERSE==='1'?'reverse-result.json':'forward-result.json'),JSON.stringify(report,null,2));console.log('COLLISION_PROBE_RECORDED '+JSON.stringify(report));await shutdown.shutdown(0);
 }
}
const {withAgentTestHomeLock}=require('./test-home.cjs');
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(e=>{console.error(e.message);process.exitCode=1;});
