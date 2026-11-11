const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  const home=process.env.DSH_HOME, native=process.env.DSH_NATIVE_ROOT;
  assert(home && native);
  process.env.DSH_MEME_HOME=path.basename(home)==='.dsh'?path.dirname(home):path.join(home,'meme-home');
  process.env.OPENAI_API_KEY='isolated-workflow-fixture';
  const load=name=>import(pathToFileURL(path.join(native,name,'lib/index.js')));
  const boot=path.join(native,'dsh/lib/profile-boot.js');
  const {runProfile}=await import(pathToFileURL(fs.existsSync(boot)?boot:path.resolve(native,'../../lib/profile-boot.js')));
  const {loadLayeredEnv}=await load('dsh-app-boot');
  const patch=path.join(home,'external-workflow-test.patch.json');
  fs.writeFileSync(patch,JSON.stringify([
    {id:'orca-agent-hooks',disabled:true},
    {id:'desktop-product-telemetry',disabled:true},
    {id:'product-analytics',disabled:true},
    {id:'dsh-external-workflow',config:{approvalMode:'never',maxAgents:4,maxConcurrency:2}},
  ]));
  const runtime=await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',patchFiles:[patch],args:['--port','0','--no-open']});
  let passed=false;
  try {
    const ctx=runtime.ctx, controller=ctx.get('sessionController');
    assert.equal(ctx.get('compactionThreshold').ratio(),0.8,'Native schema must supply the 80% default');
    assert(!ctx.get('localEnvironments'));
    assert(ctx.get('subprocess'), 'Native subprocess must be restored');
    assert(!ctx.get('nestedSessions'));assert(!ctx.get('followUps'));
    const service=ctx.get('dynamicWorkflows');assert(service);
    const cwd=path.join(home,'external-workflow-fixture');fs.mkdirSync(cwd,{recursive:true});
    let modelCalls=0;
    ctx.on('llm/stream',async function* (options) {
      modelCalls++;
      assert(!(options.tools ?? []).some(tool => ["write","edit","pwsh","bash"].includes(tool.name)), "Readonly child must not see write or shell tools");
      yield {type:'text-delta',index:0,text:'WORKFLOW_CHILD_OK'};
      yield {type:'finish',reason:{kind:'stop'}};
    });
    const matrix=[];
    for (const preset of ['standard','ptc']) {
    const beforeCalls=modelCalls;
    const created=await controller.create({cwd,agentPreset:preset});
    const {agent}=await controller.resolveAgent(created.sessionId);
    ctx.permissionPresets.set(agent.session,'read-only');
    const shell=process.platform==='win32'?'pwsh':'bash';
    const shellArgs={command:'rtk --version',description:'Verify native shell after removing local environments'};
    const shellResult=await agent.ctx.tools.execute({agent,name:preset==='ptc'?'run_code':shell,arguments:preset==='ptc'?{description:'Verify native shell through PTC',code:`const result=await tools.${shell}(${JSON.stringify(shellArgs)});console.log(result);`}:shellArgs,callId:require('node:crypto').randomUUID(),signal:AbortSignal.timeout(15000)});
    assert.equal(shellResult.isError,false,JSON.stringify(shellResult));
    assert(!ctx.get('commands').find(agent,'collaborate'));
    assert(!ctx.get('commands').find(agent,'session-bus'));
    for (const name of ['message_session','usage_report']) assert(!agent.ctx.tools.get(name,agent));
    const help=await ctx.get('commands').execute(agent,'/workflow help',[],AbortSignal.timeout(10000));
    assert.equal(help.result.kind,'success');
    for(const name of ['workflow_list','run_workflow','workflow_manage'])assert(agent.ctx.tools.get(name,agent));
    const catalog=await service.list(agent);assert(catalog.entries.length>=8);
    const {createWorkflowCapsule}=await import(pathToFileURL(path.join(home,'profiles/desktop/node_modules/@dsh-external/workflow/lib/capsule.js')));
    const capsule=createWorkflowCapsule({minDshVersion:'0.0.1-rc.2',manifest:{name:'native-children',description:'Real native subagent lifecycle with deterministic model output',phases:['run'],readOnly:true,maxAgents:2,maxConcurrency:2,patterns:['fan-out-and-synthesize']},source:'async function run(wf,args){return await wf.parallel([()=>wf.runAgent({name:"one",prompt:"Return WORKFLOW_CHILD_OK",readOnly:true}),()=>wf.runAgent({name:"two",prompt:"Return WORKFLOW_CHILD_OK",readOnly:true})]);}'});
    const run=await service.startInline(agent,{manifest:capsule.manifest,execution:'capability-generated',source:capsule.source,capsule},{},AbortSignal.timeout(60000));
    const result=await run.done;
    assert.equal(result.status,'completed',JSON.stringify(result));
    assert.equal(result.outcome.status,'completed',JSON.stringify(result));
    assert.equal(result.totalSpawned,2);assert(modelCalls>=2);
    assert(JSON.stringify(result.result).includes('WORKFLOW_CHILD_OK'),JSON.stringify(result));
    console.log('EXTERNAL_WORKFLOW_PASS '+JSON.stringify({preset,catalog:catalog.entries.length,children:result.totalSpawned,modelCalls:modelCalls-beforeCalls,status:result.outcome.status,command:help.result.kind}));
    matrix.push({workflow:true,preset,mode:agent.ctx.tools.modeFor(agent),children:result.totalSpawned});
    }
    const row=(await ctx.pluginManager.listPlugins()).find(row=>row.patchId==='dsh-external-workflow');
    assert(row?.enabled);
    await ctx.pluginManager.setPluginEnabled(row.entryId,false);
    for (const preset of ['standard','ptc']) {
      const made=await controller.create({cwd,agentPreset:preset});
      const {agent}=await controller.resolveAgent(made.sessionId);
      assert(!ctx.get('commands').find(agent,'workflow'));
      for(const name of ['workflow_list','run_workflow','workflow_manage'])assert(!agent.ctx.tools.get(name,agent));
      assert(agent.ctx.tools.get('read',agent));assert(ctx.get('subagents'));
      matrix.push({workflow:false,preset,mode:agent.ctx.tools.modeFor(agent),nativeSubagents:true});
    }
    await ctx.pluginManager.setPluginEnabled(row.entryId,true);
    console.log('WORKFLOW_MODE_MATRIX_PASS '+JSON.stringify(matrix));
    passed=true;
  } finally { await runtime.shutdown.shutdown(passed?0:1); }
}
withAgentTestHomeLock(process.env.DSH_HOME,main).catch(error=>{console.error(error.stack);process.exitCode=1;});
