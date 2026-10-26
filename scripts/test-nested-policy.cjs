const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {withAgentTestHomeLock}=require('./test-home.cjs');
async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 const cwd=path.join(home,'nested-policy');fs.mkdirSync(cwd,{recursive:true});
 const patch=path.join(cwd,'patch.json');
 fs.writeFileSync(patch,JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},{id:'dsh-memory',disabled:true}]));
 const {runProfile}=await import(pathToFileURL(path.join(native,'dsh/lib/profile-boot.js')));
 const {loadLayeredEnv}=await import(pathToFileURL(path.join(native,'dsh-app-boot/lib/index.js')));
 const {ctx,shutdown}=await runProfile({environment:loadLayeredEnv('dsh'),profile:'enhanced',patchFiles:[patch],args:['--port','0','--no-open']});
 try{
  const made=await ctx.sessionController.create({cwd,agentPreset:'standard'});
  const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent);
  assert.equal(ctx.get('nestedSessions').delegationMode(agent.id),'auto');
  for(const mode of ['on','off','auto']){
   const response=await ctx.commands.execute(agent,'/collaborate '+mode,[],AbortSignal.timeout(10000));
   assert.equal(response.result.kind,'success');
   const prompt=JSON.stringify(await agent.ctx.systemPrompt.assemble({agent,scope:agent}));
   if(mode==='on'){
    assert(prompt.includes('You coordinate linked sessions'));
    assert(!prompt.includes('You are the Team Lead named'));
   }else assert(prompt.includes('You are the Team Lead named'));
  }
  console.log('NESTED_POLICY_PASS auto/on/off use one native policy and preserve Team communication');
 }finally{await shutdown.shutdown(0);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.message);process.exitCode=1;});
