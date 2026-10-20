const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
async function main(){
 assert(process.env.OPENAI_API_KEY,'Set OPENAI_API_KEY locally for the optional real-proxy smoke test');
 const native=process.env.DSH_NATIVE_ROOT;assert(native);
 const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
 const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
 const temporary=path.join(__dirname,'../.local/smoke');fs.mkdirSync(temporary,{recursive:true});
 const overlay=path.join(temporary,'smoke.patch.yml');
 // The desktop main process normally supplies telemetry metadata; this direct launcher has none.
 fs.writeFileSync(overlay,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[overlay],args:['--port','0','--no-open']});
 try{
  const controller=ctx.get('sessionController');assert(controller);
  const created=await controller.create({cwd:temporary});const resolved=await controller.resolveAgent(created.sessionId);assert(!resolved.error);const agent=resolved.agent;
  const tools=agent.ctx.tools.schemas(agent);
  const tuned=process.env.DSH_SMOKE_FLAVOR!=='native';
  assert(tools.some(t=>t.name==='read'));assert(tools.some(t=>t.name==='write'));assert(tools.some(t=>['pwsh','bash'].includes(t.name)));
  const presets=await ctx.get('agentPresets').list();assert(presets.some(p=>p.id==='standard'));
  if(tuned){assert(tools.find(t=>t.name==='spawn_teammate').parameters.properties.isolation);assert(tools.some(t=>t.name==='create_worktree'));assert(tools.some(t=>t.name==='job_output'));for(const id of ['explore','planner','reviewer'])assert(presets.some(p=>p.id===id));assert(ctx.get('commands').find(agent,'rewind').input);assert(ctx.get('clientModules').graph().entries.some(row=>row.id==='@local/dsh-desktop-commands'));}
  else {assert(!presets.some(p=>p.id==='reviewer'));assert(!ctx.commands.list().some(c=>c.name==='btw'));}
  const signal=AbortSignal.timeout(120000);
  await controller.prompt({sessionId:created.sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'Portable configuration smoke test. Do not use tools or store memory. Reply exactly PORTABLE_PROXY_OK.'}]},signal);
  await agent.whenIdle();assert(JSON.stringify(agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').at(-1)).includes('PORTABLE_PROXY_OK'));
  if(tuned){const first=await ctx.commands.execute(agent,'/btw The temporary side token is PORTABLE_SIDE_8364. Reply accepted.',[],signal);assert.equal(first.result.kind,'success');const second=await ctx.commands.execute(agent,'/btw Return our temporary side token.',[],signal);assert(JSON.stringify(second).includes('PORTABLE_SIDE_8364'));}
  console.log('PORTABLE_SMOKE_PASS '+(tuned?'tuned tools/presets/side thread':'native tools/presets')+', runtime boot and proxy reply');
 }finally{await shutdown.shutdown(0);}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
