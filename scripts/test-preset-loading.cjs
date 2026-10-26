// No model requests: verify actual host admission before promoting a deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME;
  const native = process.env.DSH_NATIVE_ROOT;
  assert(native, 'Set DSH_NATIVE_ROOT to the matching desktop runtime');
  const output = path.join(home, 'preset-loading');
  fs.mkdirSync(output, {recursive: true});
  const patch = path.join(output, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([
    {id: 'desktop-product-telemetry', disabled: true},
    {id: 'product-analytics', disabled: true},
    ...(process.env.DSH_TEST_OPTIONAL_MISSING === '1' ? [{id: 'idle-compaction', disabled: true}] : []),
  ]));
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const profile=process.env.DSH_TEST_PROFILE || 'desktop';
  const {ctx, shutdown} = await runProfile({environment: loadLayeredEnv('dsh'), profile,
    patchFiles: [patch], args: ['--port', '0', '--no-open']});
  try {
    const report = [];
    for (const service of profile==='enhanced'?['nestedSessions', 'memoryWritePolicy', 'localEnvironments', 'followUps']:['nestedSessions'])
      assert(ctx.get(service), service + ' failed to load');
    if(profile==='desktop'){
      const plugins=await ctx.pluginManager.listPlugins();
      for(const id of ['browser-review','file-links','desktop-commands','delete-session','dsh-rewind-plugin','dynamic-ui-view','enhancement-settings']){
        const row=plugins.find(row=>row.patchId===id);
        assert(row?.enabled&&row.fiberPhase==='active',id+' is missing or inactive');
      }
    }
    for (const preset of profile==='enhanced'?['standard', 'ptc', 'explore', 'planner', 'reviewer']:['standard','ptc']) {
      const made = await ctx.sessionController.create({cwd: output, agentPreset: preset});
      const resolved = await ctx.sessionController.resolveAgent(made.sessionId);
      assert(!resolved.error && resolved.agent, preset + ': ' + JSON.stringify(resolved.error));
      const agent = resolved.agent;
      const tools = agent.ctx.tools;
      assert(tools.get('read', agent), preset + ' missing read');
      if (['standard', 'ptc'].includes(preset)) {
        assert(tools.get('start_session', agent), preset + ' missing linked sessions');
        assert.equal(tools.modeFor(agent), preset === 'ptc' ? 'ptc' : 'native');
        if(profile==='enhanced'){
          const degraded = process.env.DSH_TEST_OPTIONAL_MISSING === '1';
          assert.equal(Boolean(tools.get('workflow', agent)), !degraded, preset + ' workflow availability');
          const result = await ctx.commands.execute(agent, '/workflow', [], AbortSignal.timeout(10000));
          assert.equal(result.result.kind, degraded ? 'error' : 'success', JSON.stringify(result));
        }else{
          for(const name of ['render_widget','create_worktree','message_session','usage_report'])assert(tools.get(name,agent),preset+' missing '+name);
          const rewind=await ctx.commands.execute(agent,'/rewind __candidates',[],AbortSignal.timeout(10000));
          assert.equal(rewind.result.kind,'success','Rewind command missing');
        }
      }
      report.push({preset, loaded: true, tools: tools.schemas(agent).length});
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log('PRESET_LOADING_PASS ' + JSON.stringify(report));
  } finally {
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error => {
  console.error(error.stack); process.exitCode = 1;
});
