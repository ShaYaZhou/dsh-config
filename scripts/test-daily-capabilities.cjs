// Exercise restored daily capabilities through the pinned host, in a disposable home.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { withAgentTestHomeLock } = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME, native = process.env.DSH_NATIVE_ROOT;
  assert(home && native && home.includes(`${path.sep}.local${path.sep}`), 'Use an isolated test home');
  const output = path.join(home, 'daily-capabilities');
  fs.mkdirSync(output, { recursive: true });
  const patch = path.join(output, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([
    { id: 'desktop-product-telemetry', disabled: true },
    { id: 'product-analytics', disabled: true },
  ]));
  const { runProfile } = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const { loadLayeredEnv } = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', patchFiles: [patch], args: ['--port', '0', '--no-open'] });
  const results = [], calls = [];
  const signal = AbortSignal.timeout(300000);
  ctx.on('tools/result', (exec, result) => calls.push({ sessionId: exec.agent?.id, name: exec.name, isError: result.isError }));
  try {
    const plugins = await ctx.pluginManager.listPlugins();
    for (const id of ['better-sidebar', 'skills-manager', 'michengai-code-review', 'dsh-external-workflow']) {
      const row = plugins.find(p => p.patchId === id);
      assert(row?.enabled && row.fiberPhase === 'active', `${id} did not activate`);
    }
    for (const preset of ['standard', 'ptc']) {
      const cwd = path.join(output, preset); fs.mkdirSync(cwd, { recursive: true });
      const workspace = await ctx.workspaceRegistry.create(cwd, 'Capability acceptance ' + preset);
      const made = await ctx.sessionController.create({ workspaceId: workspace.id, agentPreset: preset });
      const { agent } = await ctx.sessionController.resolveAgent(made.sessionId);
      assert(agent); ctx.permissionPresets.set(agent.session, 'read-only');
      const skills = await agent.ctx.get('skills').list({ scope: agent, cwd });
      assert(skills.some(s => s.name === 'archify'), 'Archify is not discoverable');
      for (const name of ['think', 'ponytail', 'rtk-reference', 'openspec-explore'])
        assert(skills.some(s => s.name === name && s.path.replaceAll('\\','/').includes('inline-skills/catalog')), name + ' missing from the portable daily provider');
      for (const name of ['create_skill', 'dsh_code_review', 'workflow_list', 'render_widget'])
        assert(agent.ctx.tools.get(name, agent), `${preset} missing ${name}`);
      for (const command of ['/review-status', '/review-cancel', '/btw-history'])
        assert.equal((await ctx.commands.execute(agent, command, [], signal)).result.kind, 'success', command);

      const policy = ctx.sandboxPolicy.resolve({ session: agent.session });
      const denied = await (await ctx.shell.execute(ctx.shell.resolve({
        command: 'printf forbidden > boundary-proof.txt', workdir: cwd,
        dshEnv: { DSH_SESSION_ID: agent.id }, sandboxPolicy: policy, signal,
      }))).result();
      assert.notEqual(denied.exitCode, 0, 'Read-only write unexpectedly succeeded');
      assert(!fs.existsSync(path.join(cwd, 'boundary-proof.txt')));
      await ctx.sessions.flush(agent.session);
      results.push({ preset, sessionId: agent.id, writeDenied: true, permission: 'read-only', skills: skills.map(s => s.name), calls: calls.filter(c => c.sessionId === agent.id) });
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
    console.log('DAILY_CAPABILITIES_PASS Standard/PTC native shell boundary, tool and skill admission');
  } finally { await shutdown.shutdown(0); }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error => { console.error(error.message); process.exitCode = 1; });
