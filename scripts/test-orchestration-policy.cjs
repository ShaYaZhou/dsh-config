const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {assertIsolatedHome, withAgentTestHomeLock} = require('./test-home.cjs');

function verifyWorkflow(events) {
  const started = events.filter(e => e.type === 'tool-workflow/run-start');
  const finished = events.filter(e => e.type === 'tool-workflow/run-end');
  assert(started.length > 0, 'No recorded workflow run');
  for (const start of started) {
    const end = finished.find(e => e.data.runId === start.data.runId);
    assert.equal(end?.data.stopReason, 'completed', 'Workflow must actually complete');
    assert(events.some(e => e.type === 'tool-workflow/agent-start' && e.data.runId === start.data.runId), 'Workflow started no children');
  }
}

async function main() {
  assertIsolatedHome(process.env.DSH_HOME);
  assert(process.env.OPENAI_API_KEY, 'Real proxy credential required in process environment');
  const preset = process.env.DSH_TEST_PRESET ?? 'standard';
  const root = path.join(process.env.DSH_HOME, 'orchestration-acceptance-' + preset);
  fs.mkdirSync(root, {recursive: true});
  const files = {
    'api.txt': 'Evidence ID: API-741. User input is concatenated into a SQL query.\n',
    'ui.txt': 'Evidence ID: UI-852. A clickable div has no keyboard handler or button role.\n',
    'AGENTS.md': 'Synthetic acceptance only. Read the two txt files in this directory; do not modify files, save memory, access network, inspect credentials or other projects. Return evidence IDs with findings. Delegation may read the same fixture.\n',
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  const patch = path.join(process.env.DSH_HOME, 'orchestration-runtime.patch.json');
  fs.writeFileSync(patch, JSON.stringify([{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true}]));
  const native = process.env.DSH_NATIVE_ROOT;
  const {runProfile} = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const {loadLayeredEnv} = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const {ctx, shutdown} = await runProfile({environment:loadLayeredEnv('dsh'), profile:'desktop', patchFiles:[patch, ...(process.env.DSH_ORCHESTRATION_PATCH ? [path.resolve(process.env.DSH_ORCHESTRATION_PATCH)] : [])], args:['--port','0','--no-open']});
  const calls = [], reports = [];
  try {
    ctx.on('tools/execute', async (exec, next) => {
      calls.push({agentId:exec.agent?.id, name:exec.name});
      fs.writeFileSync(path.join(root, 'progress.json'), JSON.stringify({reports, calls}));
      return next();
    });
    const linked = await new Promise(resolve => ctx.inject(['nestedSessions'], scope => resolve(scope.nestedSessions)));
    if (process.env.DSH_VERIFY_ORCHESTRATION_ONLY === '1') {
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
      assert.equal(saved.length, 4);
      for (const report of saved) {
        const {agent} = await ctx.sessionController.resolveAgent(report.sessionId);
        assert.equal(ctx.permissionPresets.current(agent.session), 'workspace-write');
        const state=await ctx.ultracodeState.read({sessionId:agent.id},AbortSignal.timeout(30000));
        assert(state.supported);
        assert.equal(state.mode,report.mode==='linked'||report.mode==='explicit'?'linked':'workflow');
        if (report.mode === 'auto' || report.mode === 'explicit') verifyWorkflow(agent.session.snapshotEvents());
      }
      console.log('ORCHESTRATION_COLD_PASS actual completed workflow runs and child records survive restart');
      return;
    }
    const workspace = await ctx.workspaceRegistry.create(root, 'Orchestration acceptance');
    if (preset === 'ptc') {
      const created = await ctx.sessionController.create({workspaceId:workspace.id, agentPreset:'ptc'});
      const {agent} = await ctx.sessionController.resolveAgent(created.sessionId);
      assert.equal(agent.ctx.tools.modeFor(agent), 'ptc');
      const inside = path.join(root, 'boundary.txt');
      const outsideDir = fs.mkdtempSync(path.join(os.homedir(), '.dsh-ptc-boundary-'));
      const outside = path.join(outsideDir, 'sentinel.txt');
      fs.writeFileSync(outside, 'unchanged');
      const safetyResults = [];
      const releaseResults = ctx.on('tools/result', (exec, result) => {
        if(exec.agent?.id === agent.id && exec.name === 'run_code') safetyResults.push({code:exec.arguments.code,result});
      });
      const execute = async code => {
        const before=safetyResults.length;
        const signal=AbortSignal.timeout(120000);
        await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'这是合成文件的沙箱边界验收。只调用一次 run_code，逐字使用下面的代码；不要修改代码、不要使用任何其他工具、不要升级权限或尝试绕过。工具拒绝就如实报告拒绝，成功就报告成功，不写记忆。代码：\n'+code}]},signal);
        await agent.whenIdle();
        const result=safetyResults.slice(before).find(row=>row.code.trim()===code.trim());
        assert(result, 'Model did not execute the requested sandbox probe');
        return result.result;
      };
      try {
        ctx.permissionPresets.set(agent.session, 'workspace-write');
        const allowed = await execute(`await tools.write({file_path:${JSON.stringify(inside)},content:'allowed'});`);
        assert(!allowed.isError, JSON.stringify(allowed));
        assert.equal(fs.readFileSync(inside,'utf8'), 'allowed');
        ctx.permissionPresets.set(agent.session, 'read-only');
        const denied = await execute(`await tools.write({file_path:${JSON.stringify(inside)},content:'forbidden'});`);
        assert.match(JSON.stringify(denied), /denied|read.only|permission|EACCES|EPERM|not permitted/i);
        assert.equal(fs.readFileSync(inside,'utf8'), 'allowed');
        ctx.permissionPresets.set(agent.session, 'workspace-write');
        const escaped = await execute(`const fs = await import('node:fs/promises'); await fs.writeFile(${JSON.stringify(outside)},'forbidden');`);
        assert.match(JSON.stringify(escaped), /denied|permission|EACCES|EPERM|not permitted/i);
        assert.equal(fs.readFileSync(outside,'utf8'), 'unchanged');
        const cancelled = new AbortController(); cancelled.abort();
        await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'Do not run: cancelled probe'}]},cancelled.signal).catch(error=>assert.match(String(error),/abort|cancel/i));
        assert.equal(fs.readFileSync(inside,'utf8'),'allowed');
        console.log('PTC_SANDBOX_PASS allowed write, read-only refusal, raw filesystem escape refusal and cancellation');
      } finally {
        releaseResults();
        fs.rmSync(outsideDir,{recursive:true});
        if(fs.existsSync(inside))fs.unlinkSync(inside);
      }
    }
    for (const [role, supported] of [['standard',true],['ptc',true],['minimal',false],['explore',false]]) {
      const made = await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:role});
      const {agent} = await ctx.sessionController.resolveAgent(made.sessionId);
      const state = await ctx.ultracodeState.read({sessionId:agent.id},AbortSignal.timeout(30000));
      assert.equal(state.supported,supported,role);
      if (!supported) {
        const before=agent.session.snapshotEvents().length;
        const result=await ctx.commands.execute(agent,'/ultracode on',[],AbortSignal.timeout(30000));
        assert.equal(result.result.kind,'error');
        assert(!agent.session.snapshotEvents().slice(before).some(e=>e.type==='plugin:ultracode/mode'));
      }
    }
    if(process.env.DSH_ORCHESTRATION_BOUNDARIES_ONLY==='1') {console.log('PTC_BOUNDARIES_PASS sandbox and unavailable-mode capability checks');return;}
    const signal = AbortSignal.timeout(600000);
    const task = '分别审查 api.txt 和 ui.txt，独立核实各项发现，再汇总两个证据 ID 和具体问题。任务需要两路独立检查和结果聚合。只读，不写记忆。';
    for (const mode of ['simple', 'auto', 'linked', 'explicit']) {
      const made = await ctx.sessionController.create({workspaceId:workspace.id, agentPreset:preset});
      const {agent} = await ctx.sessionController.resolveAgent(made.sessionId);
      assert.equal(agent.session.header.agentPreset, preset);
      assert(agent.ctx.tools.get('workflow', agent), 'Candidate workflow unavailable');
      ctx.permissionPresets.set(agent.session, 'workspace-write');
      const command = async text => {
        const result = await ctx.commands.execute(agent, text, [], signal);
        assert.equal(result.result.kind, 'success', JSON.stringify(result));
      };
      await command('/ultracode on');
      await command(mode === 'linked' || mode === 'explicit' ? '/collaborate on' : '/collaborate auto');
      const assembly = await agent.ctx.systemPrompt.assemble({agent,scope:agent});
      const policy = assembly.sections.find(section=>section.name==='ultracode:policy')?.text;
      assert.equal(Boolean(policy), mode === 'simple' || mode === 'auto');
      assert.equal(linked.delegationMode(agent.id), mode === 'linked' || mode === 'explicit' ? 'linked' : 'auto');
      if (mode === 'explicit') await command('/workflow ' + task);
      else if (mode === 'linked') await command('/collaborate ' + task);
      else await ctx.sessionController.prompt({sessionId:agent.id, requestId:randomUUID(), mode:'queue', content:[{type:'text',text:mode === 'simple' ? '只回答 2+2 的结果，不需要工具，不写记忆。' : task}]}, signal);
      let stable = 0, previous = -1;
      while (stable < 4) {
        signal.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 500));
        const links = (await linked.list({sessionId:agent.id})).links;
        const busy = agent.status === 'running' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length || links.some(row => ['queued','running'].includes(row.status));
        const seq = agent.session.snapshotEvents().at(-1)?.seq;
        stable = !busy && seq === previous ? stable + 1 : 0;
        previous = seq;
      }
      const events = agent.session.snapshotEvents();
      const final = events.findLast(e => e.type === 'assistant/message');
      const summary = ((final?.data?.message ?? final?.data)?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const names = calls.filter(c => c.agentId === agent.id).map(c => c.name);
      if (mode === 'simple') {
        assert.match(summary, /4/);
        assert(!names.some(n => ['workflow','start_session','subagent','subagent_fork'].includes(n)));
      } else {
        assert(summary.includes('API-741') && summary.includes('UI-852'), 'Missing actual fixture evidence: ' + mode + '\n' + summary);
        assert(names.includes(mode === 'linked' ? 'start_session' : 'workflow'), 'Wrong delegation route: ' + mode + ' ' + names);
        assert(!names.includes(mode === 'linked' ? 'workflow' : 'start_session'), 'Duplicate routes: ' + mode);
      }
      assert.equal(ctx.permissionPresets.current(agent.session), 'workspace-write');
      for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(root,name),'utf8'), content);
      if (mode === 'auto' || mode === 'explicit') verifyWorkflow(events);
      reports.push({mode, sessionId:agent.id, tools:names, summary});
      fs.writeFileSync(path.join(root,'result.json'), JSON.stringify(reports,null,2));
      console.log('ORCHESTRATION_CASE_PASS ' + mode);
    }
    console.log('ORCHESTRATION_ACCEPTANCE_PASS four real model routes under workspace-write');
  } finally {
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error => {console.error(error.stack);process.exitCode=1;});
