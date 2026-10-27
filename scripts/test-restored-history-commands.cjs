const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {withAgentTestHomeLock}=require('./test-home.cjs');
async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 assert(home?.includes(`${path.sep}.local${path.sep}`),'Use an isolated home');
 const output=path.join(home,'history-command-audit');fs.mkdirSync(output,{recursive:true});
 const patch=path.join(output,'patch.json');fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js'))),{loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
 const {localGit}=await import(pathToFileURL(path.join(home,'profiles/desktop/node_modules/@local/dsh-local-environments/lib/workspace.js')));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 const signal=AbortSignal.timeout(180000),results=[];
 try{
  for(const preset of ['standard','ptc']){
   const cwd=path.join(output,preset+'-'+randomUUID());fs.mkdirSync(cwd,{recursive:true});
   fs.writeFileSync(path.join(cwd,'package.json'),'{"type":"commonjs"}\n');
   fs.writeFileSync(path.join(cwd,'sum.js'),'exports.sum = (a,b) => a+b;\n');
   await localGit(ctx,cwd,['-c','init.templateDir=','init','-b','main'],signal);
   await localGit(ctx,cwd,['add','sum.js','package.json'],signal);
   await localGit(ctx,cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','seed'],signal);
   const workspace=await ctx.workspaceRegistry.create(cwd,'Historical command acceptance');
   const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
   const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent);
   ctx.permissionPresets.set(agent.session,'workspace-write');
   const before=agent.session.snapshotEvents().length;
   const invalid=await ctx.commands.execute(agent,'/simplify --unknown-flag',[],signal);
   assert.equal(invalid.result.kind,'error');assert(!agent.session.snapshotEvents().slice(before).some(e=>e.type==='turn/start'),'Invalid simplify must not start model work');
   const init=agent.ctx.tools.get('init',agent);assert(init);
   const guidance=await init.execute({}, {agent,signal});assert(/CLAUDE\.md/.test(guidance)&&/AGENTS\.md/.test(guidance));
   assert(!fs.existsSync(path.join(cwd,'CLAUDE.md')),'Init tool must not secretly write files');
   if(process.env.DSH_COMMAND_MODELS==='1'){
    const runCommand=async command=>{
     let off;
     const started=new Promise((resolve,reject)=>{
      off=ctx.on('session/event',(session,event)=>{if(session.id===agent.id&&event.type==='turn/start')resolve();});
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
     });
     try{
      const response=await ctx.commands.execute(agent,command,[],signal);assert.equal(response.result.kind,'success');
      await started;await agent.whenIdle();
      assert.equal(agent.session.snapshotEvents().findLast(e=>e.type==='turn/end')?.data.reason.kind,'completed');
     }finally{off?.();}
    };
    fs.writeFileSync(path.join(cwd,'sum.js'),'exports.sum = (a,b) => { const result = a+b; return result; };\n');
    await runCommand('/simplify sum.js');
    delete require.cache[path.join(cwd,'sum.js')];
    assert.equal(require(path.join(cwd,'sum.js')).sum(2,3),5);
    await runCommand('/init 这是一次隔离验收。用户已明确选择只创建项目 CLAUDE.md，不创建个人文件；项目只是 sum.js 的加法模块，没有测试框架。不要再次访谈。请读取项目、生成简短 CLAUDE.md，并把 AGENTS.md 建为指向 CLAUDE.md 的相对符号链接。不联网、不委派、不改变 sum.js。');
    assert(fs.readFileSync(path.join(cwd,'CLAUDE.md'),'utf8').trim().length>0);
    assert(fs.lstatSync(path.join(cwd,'AGENTS.md')).isSymbolicLink());
    assert.equal(fs.readlinkSync(path.join(cwd,'AGENTS.md')),'CLAUDE.md');
   }
   await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'只回复 HISTORY_FIXTURE，不用工具。'}]},signal);await agent.whenIdle();
   await ctx.sessions.flush(agent.session);
   await ctx.workspaceRegistry.setSessionFavorite({sessionId:agent.id,favorite:true});
   assert((await ctx.workspaceRegistry.favoriteSessions()).favoriteSessionIds.includes(agent.id));
   await ctx.workspaceRegistry.archiveSession(agent.id);
   const preview=await ctx.workspaceRegistry.previewArchivedSession({sessionId:agent.id});
   assert(JSON.stringify(preview).includes('HISTORY_FIXTURE'));
   const restored=await ctx.workspaceRegistry.unarchiveSession(agent.id);
   assert(!restored.archivedSessionIds.includes(agent.id));
   assert((await ctx.sessionController.inspect(agent.id)).events.some(e=>e.type==='assistant/message'));
   await ctx.workspaceRegistry.setSessionFavorite({sessionId:agent.id,favorite:false});
   results.push({preset,archivePreviewRestore:true,favorites:true,initGuidance:true,invalidSimplifyRefused:true,historyPreserved:true,realInitAndSimplify:process.env.DSH_COMMAND_MODELS==='1'});
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2));
  console.log('RESTORED_HISTORY_COMMANDS_PASS Standard/PTC archive-preview-restore, favorites and command validation');
 }finally{await shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(e=>{console.error(e.message);process.exitCode=1;});
