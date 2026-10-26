// Short real-model smoke in an isolated home; no browser or filesystem work by the model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {withAgentTestHomeLock}=require('./test-home.cjs');
async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 const output=path.join(home,'inline-widget-acceptance');fs.mkdirSync(output,{recursive:true});
 const patch=path.join(output,'patch.json');fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js'))),{loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 const rows=[],calls=[];
 ctx.on('tools/result',(exec,result)=>calls.push({agent:exec.agent?.id,name:exec.name,args:exec.arguments,isError:result.isError}));
 try{
  const workspace=await ctx.workspaceRegistry.create(output,'Inline widget smoke');
  for(const preset of ['standard','ptc']){
   const made=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
   const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent);
   ctx.permissionPresets.set(agent.session,'workspace-write');
   assert(agent.ctx.tools.get('render_widget',agent));
   const skill=(await agent.ctx.get('skills').list({scope:agent,cwd:output})).find(s=>s.name==='dynamic-ui');
   assert(skill&&skill.path.includes('inline-skills'),'Use the deployed bundled skill, not a global copy');
   await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'这是紧凑内联卡片验收。先用skill工具加载dynamic-ui，再用render_widget画一张标题为“动态卡片验收”的小卡片，里面有初始值0和一个“增加”按钮，每点一次数字加1。仅本地JS交互，自包含HTML片段，不写文件、不启动浏览器、不委派、不调用其他工具。不要创建完整网页；工具成功后只回复“卡片已就绪”。'}]},AbortSignal.timeout(180000));
   await agent.whenIdle();
   const own=calls.filter(c=>c.agent===agent.id);
   assert(own.some(c=>c.name==='skill'&&!c.isError),'Skill was not actually loaded');
   assert(own.some(c=>c.name==='render_widget'&&!c.isError),'Card tool was not actually used');
   assert(!own.some(c=>['bash','write','edit','subagent','spawn_teammate'].includes(c.name)),'Unexpected execution or file work');
   assert.equal(agent.session.snapshotEvents().findLast(e=>e.type==='turn/end')?.data.reason?.kind,'completed');
   rows.push({preset,sessionId:agent.id,skillPath:skill.path,calls:own.map(c=>({name:c.name,isError:c.isError})),model:agent.session.projections?.values?.modelSelection});
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(rows,null,2));
  console.log('INLINE_WIDGET_MODEL_PASS Standard/PTC loaded skill and rendered card');
 }finally{await shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(e=>{console.error(e.message);process.exitCode=1;});
