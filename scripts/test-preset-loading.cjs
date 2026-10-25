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
  const {ctx, shutdown} = await runProfile({environment: loadLayeredEnv('dsh'), profile: 'desktop',
    patchFiles: [patch], args: ['--port', '0', '--no-open']});
  try {
    const report = [];
    for (const service of ['nestedSessions', 'memoryWritePolicy', 'localEnvironments', 'followUps'])
      assert(ctx.get(service), service + ' failed to load');
    for (const preset of ['standard', 'ptc', 'explore', 'planner', 'reviewer']) {
      const made = await ctx.sessionController.create({cwd: output, agentPreset: preset});
      const resolved = await ctx.sessionController.resolveAgent(made.sessionId);
      assert(!resolved.error && resolved.agent, preset + ': ' + JSON.stringify(resolved.error));
      const agent = resolved.agent;
      const tools = agent.ctx.tools;
      assert(tools.get('read', agent), preset + ' missing read');
      if (['standard', 'ptc'].includes(preset)) {
        const degraded = process.env.DSH_TEST_OPTIONAL_MISSING === '1';
        assert.equal(Boolean(tools.get('workflow', agent)), !degraded, preset + ' workflow availability');
        assert(tools.get('start_session', agent), preset + ' missing linked sessions');
        assert.equal(tools.modeFor(agent), preset === 'ptc' ? 'ptc' : 'native');
        const result = await ctx.commands.execute(agent, '/workflow', [], AbortSignal.timeout(10000));
        assert.equal(result.result.kind, degraded ? 'error' : 'success', JSON.stringify(result));
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
