const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {withAgentTestHomeLock}=require('./test-home.cjs');
async function main(){
 const home=process.env.DSH_HOME,n=process.env.DSH_NATIVE_ROOT,output=path.join(home,'restored-controls');
 fs.mkdirSync(output,{recursive:true});
 const cold=process.env.DSH_RESTORE_COLD==='1';
 const patch=path.join(output,cold?'cold.patch.json':'patch.json');
 fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},
  {id:'agent-default-model',config:{provider:'openai',model:'deepseek-v4.1-flash',reasoningEffort:'medium'}},
  ...(cold?[{id:'dsh-rewind-plugin',disabled:true}]:[])]));
 const {runProfile}=await import(pathToFileURL(path.join(n,'dsh/lib/profile-boot.js'))),{loadLayeredEnv}=await import(pathToFileURL(path.join(n,'dsh-app-boot/lib/index.js')));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 try{
  if(cold){
   const prior=JSON.parse(fs.readFileSync(path.join(output,'result.json')));
   assert.equal(ctx.agents.list().length,0);
   for(const row of prior){const history=await ctx.sessionController.inspect(row.sessionId);assert(history.events.some(e=>e.seq===row.userSeq&&e.type==='user/message'));assert.equal(fs.readFileSync(row.file,'utf8'),'BEFORE\n');}
   assert.equal(ctx.agents.list().length,0);
   console.log('RESTORED_CONTROLS_COLD_PASS histories readable without Rewind; no activation');return;
  }
  const rows=await ctx.pluginManager.listPlugins();
  for(const id of ['browser-review','file-links','desktop-commands','delete-session','dsh-rewind-plugin','dynamic-ui-view','enhancement-settings']){
   const row=rows.find(r=>r.patchId===id);assert(row?.enabled&&row.fiberPhase==='active',id+' not active');
  }
  assert(process.env.OPENAI_API_KEY,'Real-model test needs configured proxy credential');
  const result=[];
  const {SnapshotStore,createRewindRpcHandler}=await import(pathToFileURL(path.join(home,'profiles/desktop/node_modules/dsh-rewind-plugin/lib/index.js')));
  for(const preset of ['standard','ptc']){
   const cwd=path.join(output,preset);fs.mkdirSync(cwd,{recursive:true});const file=path.join(cwd,'fixture.txt');fs.writeFileSync(file,'BEFORE\n');
   const w=await ctx.workspaceRegistry.create(cwd,'Rewind isolated '+preset),made=await ctx.sessionController.create({workspaceId:w.id,agentPreset:preset});
   const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent);ctx.permissionPresets.set(agent.session,'workspace-write');
   assert(agent.ctx.tools.get('render_widget',agent));assert(agent.ctx.tools.get('create_worktree',agent));assert(!agent.ctx.tools.get('spawn_teammate',agent));
   await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'隔离文件回退验收：仅使用原生 write 工具把当前目录 fixture.txt 的内容改成 AFTER 加一个换行。PTC通过tools.write调用，不用原始fs或shell。不委派、不做其他操作，写入后回复完成。'}]},AbortSignal.timeout(120000));
   await agent.whenIdle();assert.equal(fs.readFileSync(file,'utf8').trim(),'AFTER');
   const userSeq=agent.session.snapshotEvents().find(e=>e.type==='user/message').seq;
   const surface=JSON.stringify(agent.session.surface.nodes);
   const beforePreview=agent.session.snapshotEvents().length;
   const query=createRewindRpcHandler(new SnapshotStore(undefined,{dshHome:home}),()=>new Map([[agent.id,agent]]),()=>true);
   const candidates=await query('candidates',{sessionId:agent.id});
   assert(candidates.ok&&candidates.value.candidates.some(row=>row.seq===userSeq),'RPC candidate lookup failed');
   const preview=await query('preview',{sessionId:agent.id,seq:userSeq});
   assert(preview.ok&&preview.value.files.some(row=>row.path===file),'RPC preview did not read the committed file snapshot');
   assert.equal(agent.session.snapshotEvents().length,beforePreview,'Read-only RPC polluted session history');
   const call=async command=>{
    const response=await ctx.commands.execute(agent,command,[],AbortSignal.timeout(30000));
    fs.appendFileSync(path.join(output,'command-results.jsonl'),JSON.stringify({preset,command,result:response.result})+'\n');
    return response;
   };
   // Upstream moved read-only preview/candidates to connection RPC. The retired
   // command must fail, while file-only and chat restoration still work.
   assert.equal((await call('/rewind preview @'+userSeq)).result.kind,'error');
   assert.equal((await call('/rewind @'+userSeq+' code')).result.kind,'success');
   assert.equal(fs.readFileSync(file,'utf8'),'BEFORE\n');assert.equal(JSON.stringify(agent.session.surface.nodes),surface,'Code-only restore changed conversation');
   assert.equal((await call('/rewind @999999 code')).result.kind,'error');assert.equal(fs.readFileSync(file,'utf8'),'BEFORE\n');
   assert.equal((await call('/rewind @'+userSeq+' chat')).result.kind,'success');
   assert(agent.session.snapshotEvents().some(e=>e.seq===userSeq&&e.type==='user/message'),'History was deleted');
   if(preset==='standard'){
    await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'只回复NO_CHANGE，不调用任何工具，不改文件。'}]},AbortSignal.timeout(120000));
    await agent.whenIdle();const emptySeq=agent.session.snapshotEvents().findLast(e=>e.type==='user/message').seq;
    const before=JSON.stringify(agent.session.surface.nodes);
    assert.equal((await call('/rewind @'+emptySeq+' code')).result.kind,'error','Missing checkpoints must not report files restored');
    assert.equal(JSON.stringify(agent.session.surface.nodes),before);assert.equal(fs.readFileSync(file,'utf8'),'BEFORE\n');
   }
   await ctx.sessions.flush(agent.session);
   result.push({preset,sessionId:agent.id,file,userSeq,rpcPreview:true,previewHistoryUnchanged:true,codeRestore:true,conversationPreserved:true,invalidTargetRefused:true,chatRewind:true});
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log('RESTORED_CONTROLS_PASS Standard/PTC real writes and Rewind verified');
 }finally{await shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
