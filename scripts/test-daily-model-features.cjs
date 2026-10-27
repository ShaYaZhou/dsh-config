const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { randomUUID } = require('node:crypto');
const { withAgentTestHomeLock } = require('./test-home.cjs');

async function main() {
  const home = process.env.DSH_HOME, native = process.env.DSH_NATIVE_ROOT;
  assert(home?.includes(`${path.sep}.local${path.sep}`) && native, 'Use an isolated home');
  const output = path.join(home, 'model-feature-audit'); fs.mkdirSync(output, { recursive: true });
  const patch = path.join(output, 'patch.json');
  fs.writeFileSync(patch, JSON.stringify([{ id: 'desktop-product-telemetry', disabled: true }, { id: 'product-analytics', disabled: true }]));
  const { runProfile } = await import(pathToFileURL(path.join(native, 'dsh/lib/profile-boot.js')));
  const { loadLayeredEnv } = await import(pathToFileURL(path.join(native, 'dsh-app-boot/lib/index.js')));
  const { localGit } = await import(pathToFileURL(path.join(home, 'profiles/desktop/node_modules/@local/dsh-local-environments/lib/workspace.js')));
  const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', patchFiles: [patch], args: ['--port', '0', '--no-open'] });
  const signal = AbortSignal.timeout(300000), calls = [], result = {};
  ctx.on('tools/result', (exec, value) => calls.push({ sessionId: exec.agent?.id, name: exec.name, isError: value.isError }));
  async function run(cwd, preset, permission, prompt) {
    const workspace = await ctx.workspaceRegistry.create(cwd, 'Model feature acceptance');
    const made = await ctx.sessionController.create({ workspaceId: workspace.id, agentPreset: preset });
    const { agent } = await ctx.sessionController.resolveAgent(made.sessionId); assert(agent);
    ctx.permissionPresets.set(agent.session, permission);
    await ctx.sessionController.prompt({ sessionId: agent.id, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal);
    await Promise.race([agent.whenIdle(), new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
    assert.equal(agent.session.snapshotEvents().findLast(e => e.type === 'turn/end')?.data.reason.kind, 'completed');
    await ctx.sessions.flush(agent.session);
    return agent;
  }
  try {
    const review = path.join(output, 'review'); fs.mkdirSync(review, { recursive: true });
    fs.writeFileSync(path.join(review, 'math.js'), 'exports.add = (a, b) => a + b;\n');
    await localGit(ctx, review, ['-c','init.templateDir=','init','-b','main'], signal);
    await localGit(ctx, review, ['add','math.js'], signal);
    await localGit(ctx, review, ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline'], signal);
    const broken = 'exports.add = (a, b) => a - b;\n'; fs.writeFileSync(path.join(review, 'math.js'), broken);
    const reviewer = await run(review, 'standard', 'read-only', '仅调用一次 dsh_code_review，input 为“审查未提交的 math.js 改动；add 应返回两个数之和。只报告有证据的错误，不修复，不运行其他额外审查”。完整转述工具报告后结束。');
    assert(calls.some(c => c.sessionId === reviewer.id && c.name === 'dsh_code_review' && !c.isError));
    const report = await ctx.commands.execute(reviewer, '/review-status', [], signal);
    assert.equal(report.result.kind, 'success');
    assert(/math\.js/.test(report.result.text) && /减|subtract|a - b/.test(report.result.text), 'Review did not identify the seeded regression');
    assert.equal(fs.readFileSync(path.join(review, 'math.js'), 'utf8'), broken);
    result.review = { sessionId: reviewer.id, discoveredSeededBug: true, inputUnchanged: true, persistedReport: true };
    fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(result, null, 2));
    const diagram = path.join(output, 'diagram'); fs.mkdirSync(diagram, { recursive: true });
    const artist = await run(diagram, 'ptc', 'workspace-write', '先用skill读取archify，按技能制作最小可用的两节点架构图：用户 → 服务。保存 architecture.html，自包含且含inline SVG。不要联网、不要委派、不要运行浏览器、不要新增依赖。使用技能自带验证器验证；完成后只提供文件路径。');
    assert(calls.some(c => c.sessionId === artist.id && c.name === 'skill' && !c.isError));
    const html = fs.readFileSync(path.join(diagram, 'architecture.html'), 'utf8');
    assert(/<svg[\s>]/i.test(html) && /用户/.test(html) && /服务/.test(html));
    result.archify = { sessionId: artist.id, generatedHtml: true, inlineSvg: true, file: 'diagram/architecture.html' };
    result.calls = calls;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log('DAILY_MODEL_FEATURES_PASS real review and Archify delivery');
  } finally { await shutdown.shutdown(0); }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch(error => { console.error(error.message); process.exitCode = 1; });
