const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  // This isolated probe does not generate model responses. Populate only the
  // credential reference needed for the native static model catalogue.
  process.env.OPENAI_API_KEY='isolated-acceptance-not-a-real-key';
  const profile = process.argv[2] || 'desktop';
  assert(profile === 'desktop', 'This test requires a Web Host profile');
  const native = process.env.DSH_NATIVE_ROOT;
  assert(native, 'Set DSH_NATIVE_ROOT to the matching runtime packages');
  const load = name => import(pathToFileURL(path.join(native, name, 'lib/index.js')));
  const bundledBoot = path.join(native, 'dsh/lib/profile-boot.js');
  const boot = fs.existsSync(bundledBoot) ? bundledBoot : path.resolve(native, '../../lib/profile-boot.js');
  const {runProfile} = await import(pathToFileURL(boot));
  const {loadLayeredEnv} = await load('dsh-app-boot');
  const {readPluginInventory} = await load('dsh-host-plugin-inventory');
  const patch = path.join(process.env.DSH_HOME, 'compatibility.patch.json');
  fs.writeFileSync(patch, JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const runtime = await runProfile({environment:loadLayeredEnv('dsh'),profile,patchFiles:[patch],args:['--port','0','--no-open']});
  let passed = false;
  try {
    const ctx = runtime.ctx;
    const controller = ctx.get('sessionController');
    const workspace = path.join(process.env.DSH_HOME, 'compatibility-workspace');
    fs.mkdirSync(workspace, {recursive:true});
    const created = await controller.create({cwd:workspace,agentPreset:'standard'});
    const resolved = await controller.resolveAgent(created.sessionId);
    assert(!resolved.error && resolved.agent, 'Standard session must resolve');
    const inventory = await readPluginInventory(ctx);
    assert(inventory.entries.length > 0, 'Inventory must not be empty');
    const failed = inventory.entries.filter(row => row.enabled && row.fiberPhase === 'failed');
    assert.deepEqual(failed.map(row => row.moduleName), []);
    assert.deepEqual((inventory.agentPresets || []).filter(row => row.broken).map(row => row.id), []);
    if (profile !== 'headless') {
      for (const name of ['liclick-adapter','idle-settings','dynamic-ui-view']) {
        const row = inventory.entries.find(row => row.moduleName === '@local/dsh-' + name);
        assert(row?.enabled && row.fiberPhase === 'active', `${name} must load: ${JSON.stringify(row)}`);
      }
      assert(ctx.get('clientModules').graph().entries.some(row => row.id === '@local/dsh-desktop-commands'), 'Desktop /agents UI must be registered');
      for (const name of ['btw','rewind'])
        assert(ctx.get('commands').find(resolved.agent, name), `Missing command: ${name}`);
      for (const name of ['dsh-mnemon','@deepseek-ai/dsh-experimental-computer-use-cua-driver-native']) {
        const row=inventory.entries.find(row=>row.moduleName===name);
        assert(row?.enabled&&row.fiberPhase==='active', `${name} must be active`);
      }
      for (const name of ['workflowEngine','ultracodeState','idleCompaction']) assert(!ctx.get(name), `${name} is retired`);
      assert(!ctx.get('hooksController'), 'Original Hooks must remain unmounted pending upstream compatibility');
      for(const name of ['hooks','workflow'])assert(!ctx.get('commands').find(resolved.agent,name),name+' must remain unavailable');
      assert.equal(ctx.get('compactionThreshold').ratio(),0.8);
      const {createUserMessage}=await load('dsh-llm');
      const {randomUUID}=require('node:crypto');
      const begin=async (agent,text) => {
        const message=createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
        agent.session.append('user/message',message,{surfaceOp:'append'});
        agent.session.append('turn/start',{turn:1});
        await agent.ctx.waterfall('agent/pre-step',{agent,messages:[message],turn:1,step:1,signal:AbortSignal.timeout(15000)},async()=>({kind:'accept',messages:[message]}));
      };
      const call=async (agent,name,args)=>agent.ctx.tools.execute({agent,name,arguments:args,callId:randomUUID(),signal:AbortSignal.timeout(15000)});
      await begin(resolved.agent,'Remember the isolated acceptance marker only.');
      const marker='isolated-mnemon-policy-'+randomUUID();
      const saved=await call(resolved.agent,'mnemon_runtime_memory',{action:'add',target:'memory',content:marker});
      assert.equal(saved.isError,false,JSON.stringify(saved));
      const route=ctx.get('agentDefaultModel').currentSelection();
      console.log('ACCEPTANCE_MODEL_CATALOG',JSON.stringify({route,models:(await ctx.get('llm').listModels(route.provider)).map(item=>item.id)}));
      assert(!ctx.get('dynamicWorkflows'), 'Original Workflow must remain unmounted pending upstream compatibility');
      assert(!ctx.get('nestedSessions'));
      assert(!ctx.get('followUps'));
      assert(!ctx.get('memoryWritePolicy'));
      console.log('UNIFIED_CAPABILITIES_PASS memory=upstream workflow=unmounted hooks=unmounted threshold=80 dynamic-ui=loaded');
    }
    console.log('RUNTIME_COMPATIBILITY_PASS ' + JSON.stringify({profile,entries:inventory.entries.length,failed:failed.length}));
    passed = true;
  } finally {
    await runtime.shutdown.shutdown(passed ? 0 : 1);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error => { console.error(error.stack); process.exit(1); });
