// Real host loading/toggle regression; no model requests or production writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {withAgentTestHomeLock} = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME, native = process.env.DSH_NATIVE_ROOT;
  assert(home && native, 'Use an isolated DSH_HOME and matching DSH_NATIVE_ROOT');
  const output = path.join(home, 'enhancement-switch-test');
  fs.mkdirSync(path.join(output, '.claude'), {recursive:true});
  fs.writeFileSync(path.join(output, '.claude', 'CLAUDE.md'), 'SWITCH_CONTEXT_FIXTURE');
  const patch = path.join(output, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([
    {id:'desktop-product-telemetry',disabled:true}, {id:'product-analytics',disabled:true},
  ]));
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const {ctx,shutdown} = await runProfile({environment:loadLayeredEnv('dsh'),profile:'desktop',
    patchFiles:[patch],args:['--port','0','--no-open']});
  const workspace = await ctx.workspaceRegistry.create(output, 'Enhancement switch regression');
  const groups = [
    {ids:['agent-team-local','tool-agent-team-local'],tool:'spawn_teammate'},
    {ids:['tool-worktree'],tool:'create_worktree'},
    {ids:['browser-guidance'],section:'browser-computer-workflow'},
    {ids:['session-bus'],tool:'message_session'},
    {ids:['claude-context'],section:'claude-context'},
    {ids:['usage-report'],tool:'usage_report'},
  ];
  async function set(group, enabled) {
    for(const id of group.ids) await ctx.pluginManager.setPluginEnabled('include:'+id, enabled);
    const rows = await ctx.pluginManager.listPlugins();
    for(const id of group.ids) {
      const row = rows.find(r=>r.entryId==='include:'+id);
      assert(row && row.enabled===enabled && !row.readOnlyReason, id+' toggle failed');
      if(enabled) assert.equal(row.fiberPhase,'active',id+' did not activate');
    }
  }
  async function check(group, enabled) {
    for(const preset of ['standard','ptc']) {
      const made = await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:preset});
      const {agent,error} = await ctx.sessionController.resolveAgent(made.sessionId);
      assert(agent && !error, preset+' failed to load');
      if(group.tool) assert.equal(Boolean(agent.ctx.tools.get(group.tool,agent)),enabled,preset+': '+group.tool);
      if(group.section) {
        const prompt = await agent.ctx.systemPrompt.assemble({agent,scope:agent});
        assert.equal([...prompt.sections,...prompt.contexts].some(s=>s.name===group.section),enabled,preset+': '+group.section);
        if(group.section==='claude-context') assert.equal(JSON.stringify(prompt).includes('SWITCH_CONTEXT_FIXTURE'),enabled);
      }
    }
  }
  try {
    for(const group of groups) { await set(group,false); await check(group,false); }
    for(const group of groups) {
      await set(group,true); await check(group,true);
      await set(group,false); await check(group,false);
    }
    // Bus and Team have separate lifecycles; disabling one must not remove the other.
    await set(groups[0],true); await set(groups[3],true);
    await set(groups[3],false); await check(groups[0],true);
    await set(groups[3],true); await set(groups[0],false); await check(groups[3],true);
    console.log('DAILY_ENHANCEMENT_SWITCHES_PASS Standard/PTC six on/off and Team/bus independence');
  } finally {
    for(const group of groups) await set(group,false);
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error=>{
  console.error(error.stack); process.exitCode=1;
});
