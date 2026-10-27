// No model requests: verify actual host admission before promoting a deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME;
  const native = process.env.DSH_NATIVE_ROOT;
  assert(native, 'Set DSH_NATIVE_ROOT to the matching desktop runtime');
  const output = path.join(home, 'preset-loading');
  // Avoid inheriting this repository's .dsh/skills during the clean-install proof.
  const workspace = process.env.DSH_VERIFY_MANAGED_SKILLS==='1'
    ? fs.mkdtempSync(path.join(os.tmpdir(),'dsh-managed-skills-')) : output;
  fs.mkdirSync(output, {recursive: true});
  const patch = path.join(output, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([
    {id: 'desktop-product-telemetry', disabled: true},
    {id: 'product-analytics', disabled: true},
    ...(process.env.DSH_VERIFY_MANAGED_SKILLS==='1'?[{id:'skills-manager',disabled:true}]:[]),
    ...(process.env.DSH_TEST_OPTIONAL_MISSING === '1' ? [{id: 'idle-compaction', disabled: true}] : []),
  ]));
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const profile=process.env.DSH_TEST_PROFILE || 'desktop';
  const {ctx, shutdown} = await runProfile({environment: loadLayeredEnv('dsh'), profile,
    patchFiles: [patch], args: ['--port', '0', '--no-open']});
  try {
    const report = [];
    const sidebar = path.join(home, 'profiles', profile, 'node_modules/dsh-better-sidebar/lib/index.js');
    if(fs.existsSync(sidebar)){
      const source=fs.readFileSync(sidebar,'utf8');
      const blocked=()=>{throw new Error('fixture: native spawn denied');};
      for(const [start,end,call] of [
        ['function verify(binary) {','/** Escape glob','verify("fixture")'],
        ['function probeTool(bin, spawner) {','/** Probe result cache','probeTool("fixture", spawn)'],
      ]){
        const code=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
        assert.equal(await vm.runInNewContext(code+'\n'+call,{spawn:blocked,clearTimeout,setTimeout}),false,'Denied executable probes must return unavailable, not throw a timer error');
      }
    }
    for (const service of profile==='enhanced'?['nestedSessions', 'memoryWritePolicy', 'localEnvironments', 'followUps']:['nestedSessions'])
      assert(ctx.get(service), service + ' failed to load');
    if(profile==='desktop'){
      const plugins=await ctx.pluginManager.listPlugins();
      for(const id of ['browser-review','file-links','desktop-commands','delete-session','dsh-rewind-plugin','dynamic-ui-view','enhancement-settings','michengai-btw','archify-skill-filesystem','better-sidebar','skills-manager','michengai-code-review','subagent-workspace-manager','local-environments','follow-ups','team-view','ui-workspace-archive-manager','michengai-simplify','dsh-init']){
        if(id==='skills-manager'&&process.env.DSH_VERIFY_MANAGED_SKILLS==='1')continue;
        const row=plugins.find(row=>row.patchId===id);
        assert(row?.enabled&&row.fiberPhase==='active',id+' is missing or inactive');
      }
    }
    for (const preset of profile==='enhanced'?['standard', 'ptc', 'explore', 'planner', 'reviewer']:['standard','ptc']) {
      const made = await ctx.sessionController.create({cwd: workspace, agentPreset: preset});
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
          const commands=ctx.commands.list(agent).map(command=>command.name);
          for(const name of ['init','simplify','review','btw','rewind'])assert(commands.includes(name),name+' absent from command registry');
          const skills=await agent.ctx.get("skills").list({scope:agent,cwd:workspace});
          for(const name of ['think','ponytail','rtk-reference','openspec-explore'])assert(skills.some(skill=>skill.name===name&&(process.env.DSH_VERIFY_MANAGED_SKILLS!=='1'||skill.path.includes('inline-skills/catalog'))),name+' missing portable skill');
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
