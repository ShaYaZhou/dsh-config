const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {withAgentTestHomeLock}=require('./test-home.cjs');

async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 assert(home&&native);process.env.OPENAI_API_KEY='isolated-parity-fixture';
 process.env.DSH_MEME_HOME=path.basename(home)==='.dsh'?path.dirname(home):path.join(home,'meme-home');
 const load=name=>import(pathToFileURL(path.join(native,name,'lib/index.js')));
 const boot=path.join(native,'dsh/lib/profile-boot.js');
 const {runProfile}=await import(pathToFileURL(fs.existsSync(boot)?boot:path.resolve(native,'../../lib/profile-boot.js')));
 const {loadLayeredEnv}=await load('dsh-app-boot');
 const {readPluginInventory}=await load('dsh-host-plugin-inventory');
 const patch=path.join(home,'installed-parity.patch.json');
 fs.writeFileSync(patch,JSON.stringify([{id:'orca-agent-hooks',disabled:true},{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
 const runtime=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 let passed=false;
 try{
  const ctx=runtime.ctx,inventory=await readPluginInventory(ctx);
  const failed=inventory.entries.filter(row=>row.enabled&&row.fiberPhase==='failed');
  assert.deepEqual(failed.map(row=>row.moduleName),[]);
  for(const name of ['dsh-meme','dsh-whale-widget','dsh-comfyui','dsh-ego-browser']){
   const rows=inventory.entries.filter(row=>row.moduleName===name);
   assert(rows.some(row=>row.enabled&&row.fiberPhase==='active'),name+' must load');
  }
  const cwd=path.join(home,'parity-workspace');fs.mkdirSync(cwd,{recursive:true});
  const made=await ctx.sessionController.create({cwd,agentPreset:'standard'});
  const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);
  const rtk=await agent.ctx.get('skills').get('rtk-reference',{scope:agent,cwd});
  assert.equal(path.resolve(rtk.path),path.resolve(home,'skills/rtk-reference/SKILL.md'),'DSH corrected RTK skill must outrank shared older definitions');
  assert(agent.ctx.tools.get('send_meme',agent));assert(!agent.ctx.tools.get('run_workflow',agent));
  assert(!ctx.get('hooksController'),'Original Hooks must remain unmounted pending upstream compatibility');
  const catalog=path.join(home,'skills');
  const sources=JSON.parse(fs.readFileSync(path.join(__dirname,'../config/skill-sources.json'),'utf8'));
  for(const name of Object.keys(sources)){
   const target=path.join(catalog,name,'SKILL.md');assert(fs.existsSync(target),name+' was not deployed');
   const found=await agent.ctx.get('skills').get(name,{scope:agent,cwd});
   assert.equal(path.resolve(found.path),path.resolve(target),name+' must use the managed DSH copy');
  }
  console.log('INSTALLED_PARITY_PASS '+JSON.stringify({failed:0,addedSkills:Object.keys(sources).length,communityPlugins:4,rtkWinner:'DSH managed skill',hooks:'unmounted'}));
  passed=true;
 }finally{await runtime.shutdown.shutdown(passed?0:1);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
