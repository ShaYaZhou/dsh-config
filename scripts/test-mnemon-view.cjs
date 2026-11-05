// Real host sessions/tools and native maintenance workers; synthetic content only.
// Use an isolated home and explicitly supplied model credentials; never write the database directly.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {withAgentTestHomeLock}=require('./test-home.cjs');

async function main(){
 const home=process.env.DSH_HOME,native=process.env.DSH_NATIVE_ROOT;
 assert(home&&native);
 if(process.argv[2]==='empty')process.env.OPENAI_API_KEY='isolated-memory-acceptance';
 process.env.DSH_MEME_HOME=path.join(home,'meme-home');
 const bad=process.argv[2]==='empty',readOnly=process.argv[2]==='readonly';
 const load=name=>import(pathToFileURL(path.join(native,name,'lib/index.js')));
 const boot=path.join(native,'dsh/lib/profile-boot.js');
 const {runProfile}=await import(pathToFileURL(fs.existsSync(boot)?boot:path.resolve(native,'../../lib/profile-boot.js')));
 const {loadLayeredEnv}=await load('dsh-app-boot');
 const {createUserMessage}=await load('dsh-llm');
 const patch=path.join(home,'mnemon-view-test.patch.json');
 fs.writeFileSync(patch,JSON.stringify([
  {id:'orca-agent-hooks',disabled:true},{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},
  {id:'mnemon',config:{storageScope:'custom',runtimeUserScope:'storage',dataDir:path.join(home,'mnemon'),cliPath:path.join(home,'profiles/desktop/node_modules/@mnemon-dev/mnemon/bin/mnemon.js'),embedding:{enabled:true,endpoint:'http://127.0.0.1:11434',model:'nomic-embed-text',protocol:'ollama'},memoryView:{strategyTypeId:'default-three-tier',entries:{
   'include:mnemon-strategy-scoped':{config:bad?{sourceKeys:[]}:readOnly?{writableSourceKeys:[]}:{}}
  }}}}
 ]));
 const runtime=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
 let passed=false;
 try{
  const ctx=runtime.ctx;
  const effective=await ctx.get('mnemonRemote').settings('get',{},AbortSignal.timeout(10000));
  fs.writeFileSync(path.join(home,'effective-test-settings.json'),JSON.stringify(effective));
  assert.equal(effective.value?.value?.storageScope,'custom');
  assert.equal(effective.value?.value?.dataDir,path.join(home,'mnemon'),'test storage must stay in isolated home');
  const cwd=path.join(home,'memory-test-workspace');fs.mkdirSync(cwd,{recursive:true});
  const fresh=async(preset='standard')=>{
   const made=await ctx.sessionController.create({cwd,agentPreset:preset});
   const {agent,error}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent&&!error);
   const message=createUserMessage({content:[{type:'text',text:'The user authorizes synthetic memory acceptance: create a test space, store and read uniquely tagged test facts.'}],source:{kind:'user'}});
   agent.session.append('user/message',message,{surfaceOp:'append'});agent.session.append('turn/start',{turn:1});
   await agent.ctx.systemPrompt.assemble({agent,scope:agent});
   const decision=await agent.ctx.waterfall('agent/pre-step',{agent,messages:[message],turn:1,step:1,signal:AbortSignal.timeout(30000)},async()=>({kind:'accept',messages:[message]}));
   agent.acceptanceSnapshot=JSON.stringify(decision);
   fs.writeFileSync(path.join(home,'last-test-snapshot.json'),JSON.stringify(decision));
   await agent.ctx.systemPrompt.assemble({agent,scope:agent});
   return agent;
  };
  const call=async(agent,name,args)=>agent.ctx.tools.execute({agent,name:agent.ctx.tools.modeFor(agent)==='ptc'?'run_code':name,arguments:agent.ctx.tools.modeFor(agent)==='ptc'?{description:'Memory View acceptance',code:`console.log(JSON.stringify(await tools.${name}(${JSON.stringify(args)})));`}:args,callId:randomUUID(),signal:AbortSignal.timeout(120000)});
  const check=(result,label)=>{fs.appendFileSync(path.join(home,'memory-test-receipts.jsonl'),JSON.stringify({label,result})+'\n');assert(!result.isError,label+': '+JSON.stringify(result));return JSON.stringify(result);};
  if(bad){
   const agent=await fresh();
   for(const [name,args] of [['mnemon_runtime_memory',{action:'add',target:'memory',content:'denied-test'}],['mnemon_memory_bodies',{}]]){
    const result=await call(agent,name,args);assert(result.isError);assert.match(JSON.stringify(result),/not offered/);
   }
   console.log('MNEMON_EMPTY_SCOPE_REPRODUCED');passed=true;return;
  }
  if(readOnly){
   const agent=await fresh();
   check(await call(agent,'mnemon_memory_bodies',{}),'read-only inspect');
   const refused=await call(agent,'mnemon_runtime_memory',{action:'add',target:'memory',content:'must-not-write'});
   assert(refused.isError);assert.match(JSON.stringify(refused),/not offered|not authorized|read.only/i);
   console.log('MNEMON_READONLY_PRESERVED');passed=true;return;
  }
  const calls=[];
  ctx.on('tools/result',(exec,result)=>{calls.push({sessionId:exec.agent?.id,name:exec.name,isError:result.isError,result});});
  const run=async(preset,prompt)=>{
   const made=await ctx.sessionController.create({cwd,agentPreset:preset});
   const {agent}=await ctx.sessionController.resolveAgent(made.sessionId);assert(agent);
   ctx.permissionPresets.set(agent.session,'workspace-write');
   const signal=AbortSignal.timeout(240000);
   await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:prompt}]},signal);
   await Promise.race([agent.whenIdle(),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);
   assert.equal(agent.session.snapshotEvents().findLast(e=>e.type==='turn/end')?.data.reason.kind,'completed');
   await ctx.sessions.flush(agent.session);
   return agent;
  };
  const reports=[];
  for(const preset of ['standard','ptc']){
   const nonce=randomUUID(),hotKey='mnemon-hot-'+preset+'-'+nonce.slice(0,8),durableKey='mnemon-durable-'+preset+'-'+nonce.slice(0,8);
   const hotValue='hot-value-'+randomUUID(),durableValue='durable-value-'+randomUUID();
   const writer=await run(preset,`This is an explicitly authorized memory integration test in an isolated data directory. Store exactly this hot-memory fact with mnemon_runtime_memory: ${hotKey} = ${hotValue}. Store exactly this durable fact in the active Mnemon Native space with mnemon_remember: ${durableKey} = ${durableValue}. If no space is active, create one through mnemon_memory_body_create first. Use only Mnemon tools (and run_code to dispatch them in PTC). No shell, file reads/writes, database access, browsers or other delegation. Wait for both receipts and report them; do not just describe the steps.`);
   const own=calls.filter(c=>c.sessionId===writer.id);
   for(const name of ['mnemon_runtime_memory','mnemon_remember'])assert.equal(own.filter(c=>c.name===name&&!c.isError).length,1,'writer must commit exactly once through '+name);
   const reader=await run(preset,`This is the second new session for an isolated memory test. Read the value for hot-memory key ${hotKey} from the injected runtime memory; call mnemon_recall for durable-memory key ${durableKey}, then report both exact values. This message does not contain either value. Do not write anything. Use only Mnemon read tools (and run_code for PTC dispatch), no file/database/shell/browser access.`);
   const events=reader.session.snapshotEvents();
   const answers=events.filter(e=>e.type==='assistant/message');
   const text=JSON.stringify(answers);
   fs.writeFileSync(path.join(home,'memory-reader-'+preset+'.json'),JSON.stringify(events));
   assert(text.includes(hotValue),'new session did not read the hot value');
   assert(text.includes(durableValue),'new session did not recall the durable value');
   assert(calls.some(c=>c.sessionId===reader.id&&c.name==='mnemon_recall'&&!c.isError));
   const used=calls.filter(c=>[writer.id,reader.id].includes(c.sessionId));
   assert(used.every(c=>c.name.startsWith('mnemon_')||c.name==='run_code'),'test used a non-memory bypass');
   reports.push({preset,writer:writer.id,reader:reader.id,hotRead:true,durableRead:true});
   fs.writeFileSync(path.join(home,'memory-real-result.json'),JSON.stringify({reports,calls},null,2));
   console.log('MNEMON_NEW_SESSION_READ_WRITE_PASS '+preset);
  }
  passed=true;
 }finally{await runtime.shutdown.shutdown(passed?0:1);}
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
