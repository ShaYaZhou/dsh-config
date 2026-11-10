import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_ENDPOINT, EMBED_MODEL, checkMnemonEmbedding, cliCandidates, dshHome, evaluate,
  expectedDims, parseArgs, platformHints, probeEmbedding, resolveCli, runEmbedStatus,
} from '../scripts/check-mnemon-embedding.mjs';

const repoRoot = new URL('..', import.meta.url);
const read = file => fs.readFileSync(new URL(file, repoRoot), 'utf8');

test('嵌入模型模板与约定维度一致', () => {
  assert.equal(EMBED_MODEL, 'qwen3-embedding:0.6b');
  assert.equal(DEFAULT_ENDPOINT, 'http://127.0.0.1:11434');
  assert.equal(expectedDims('qwen3-embedding:0.6b'), 1024);
  assert.equal(expectedDims('nomic-embed-text'), 768);
  assert.equal(expectedDims('unknown-model:1b'), null);
  const template = JSON.parse(read('config/mnemon.json'));
  assert.equal(template.embedding.model, EMBED_MODEL);
  assert.equal(template.embedding.endpoint, DEFAULT_ENDPOINT);
});

test('自动记录指引写入模板，且不携带凭据', () => {
  const template = JSON.parse(read('config/mnemon.json'));
  const entry = template.memoryView.entries['include:mnemon-strategy-auto-capture'];
  assert.deepEqual(entry.config.sourceKeys, ['source:include:mnemon-source-memory-spaces'],
    '自动记录必须落到记忆空间来源，否则不会产生向量');
  const instruction = entry.config.instruction ?? '';
  assert(instruction.includes('环境/配置事实') && instruction.includes('有证据的踩坑结论') && instruction.includes('项目决策'),
    '指引应保留三类可记录事实');
  assert(instruction.includes('密钥') && instruction.includes('不要记录'), '指引应保留禁止项');
  assert(!Object.hasOwn(template.embedding, 'apiKey'));
});

test('CLI 候选路径跟随 DSH_HOME 与默认主目录', () => {
  const root = path.join(path.sep, 'opt', 'dsh');
  const home = path.join(path.sep, 'home', 'example');
  const candidates = cliCandidates({env: {DSH_HOME: root}, home});
  const profileCli = base => path.join(path.resolve(base), 'profiles', 'desktop', 'node_modules', '@mnemon-dev', 'mnemon', 'bin', 'mnemon.js');
  assert.equal(candidates[0], profileCli(root));
  assert.equal(candidates.length, 2, 'desktop 与 headless 两个 profile 都要尝试');
  assert.equal(dshHome({env: {}, home}), path.join(home, '.dsh'));
  assert.equal(dshHome({env: {DSH_HOME: root}, home}), path.resolve(root));
  const withEnv = cliCandidates({env: {DSH_HOME: root, MNEMON_CLI_JS: path.join(path.sep, 'tmp', 'custom.js')}, home});
  assert.equal(withEnv[0], path.resolve(path.join(path.sep, 'tmp', 'custom.js')));
});

test('resolveCli 优先 profile 内的同版 CLI，其次 PATH', () => {
  const root = path.join(path.sep, 'opt', 'dsh');
  const home = path.join(path.sep, 'home', 'example');
  const mac = cliCandidates({env: {DSH_HOME: root}, home})[0];
  assert.deepEqual(resolveCli({env: {DSH_HOME: root}, home, exists: p => p === mac, which: () => path.join(path.sep, 'usr', 'local', 'bin', 'mnemon')}),
    {kind: 'node', command: process.execPath, prefix: [mac], resolved: mac});
  assert.deepEqual(resolveCli({env: {}, home, exists: () => false, which: () => path.join(path.sep, 'usr', 'local', 'bin', 'mnemon')}),
    {kind: 'binary', command: path.join(path.sep, 'usr', 'local', 'bin', 'mnemon'), prefix: [], resolved: path.join(path.sep, 'usr', 'local', 'bin', 'mnemon')});
  assert.equal(resolveCli({env: {}, home: path.join(path.sep, 'home', 'example'), exists: () => false, which: () => null}), null);
});

test('参数解析默认值与本机数据目录', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.endpoint, DEFAULT_ENDPOINT);
  assert.equal(defaults.model, EMBED_MODEL);
  assert.equal(defaults.dataDir, path.join(dshHome(), 'mnemon'));
  const parsed = parseArgs(['--endpoint=http://127.0.0.1:9999', '--model', 'qwen3-embedding:4b', '--data-dir', '/tmp/mnemon', '--timeout-ms', '2000']);
  assert.deepEqual(parsed, {endpoint: 'http://127.0.0.1:9999', model: 'qwen3-embedding:4b', dataDir: '/tmp/mnemon', timeoutMs: 2000});
  assert.throws(() => parseArgs(['--nope']), /未知参数/);
  assert.throws(() => parseArgs(['--model']), /缺少取值/);
});

const fakeFetch = ({models = [], dims = 1024, tagsStatus = 200, embedStatus = 200, clusterCalls = []} = {}) => async (url, init) => {
  clusterCalls.push({path: url.pathname, method: init?.method ?? 'GET'});
  if (url.pathname === '/api/tags') {
    return {ok: tagsStatus === 200, status: tagsStatus, json: async () => ({models: models.map(name => ({name}))})};
  }
  return {ok: embedStatus === 200, status: embedStatus, json: async () => ({embeddings: [Array(dims).fill(0.1)]})};
};

test('probeEmbedding 报告维度，模型缺失时给出拉取命令', async () => {
  const ok = await probeEmbedding({fetchImpl: fakeFetch({models: ['qwen3-embedding:0.6b', 'nomic-embed-text:latest'], dims: 1024})});
  assert.equal(ok.dimensions, 1024);
  assert.deepEqual(ok.models.sort(), ['nomic-embed-text', 'qwen3-embedding:0.6b']);
  await assert.rejects(probeEmbedding({fetchImpl: fakeFetch({models: ['nomic-embed-text']})}), /ollama pull qwen3-embedding:0\.6b/);
  await assert.rejects(probeEmbedding({fetchImpl: async () => { const error = new Error('refused'); error.code = 'ECONNREFUSED'; throw error; }}), /无法连接 Ollama 端点/);
  await assert.rejects(probeEmbedding({fetchImpl: fakeFetch({models: ['qwen3-embedding:0.6b'], embedStatus: 404})}), /HTTP 404/);
});

test('runEmbedStatus 解析 JSON 并显式带上模型参数', () => {
  let captured;
  const run = (command, args) => {
    captured = {command, args};
    return {status: 0, stdout: 'warn line\n{"coverage":"100%","embedded":2,"total_insights":2,"embedding_available":true}\n', stderr: ''};
  };
  const status = runEmbedStatus({cli: {command: 'node', prefix: ['/opt/cli.js']}, dataDir: '/tmp/mnemon', model: EMBED_MODEL, run, platform: 'darwin'});
  assert.deepEqual(status, {coverage: '100%', embedded: 2, total_insights: 2, embedding_available: true});
  assert.deepEqual(captured.args, ['/opt/cli.js', '--data-dir', '/tmp/mnemon', '--embed-model', EMBED_MODEL, 'embed', '--status']);
  assert.throws(() => runEmbedStatus({cli: {command: 'node', prefix: []}, dataDir: '/tmp', model: EMBED_MODEL, run: () => ({status: 1, stdout: '', stderr: 'boom'})}), /退出码 1/);
  assert.throws(() => runEmbedStatus({cli: {command: 'node', prefix: []}, dataDir: '/tmp', model: EMBED_MODEL, run: () => ({status: 0, stdout: 'no json'})}), /没有返回 JSON/);
});

test('evaluate 覆盖维度、可用性与覆盖率三类失败', () => {
  const healthy = {coverage: '100%', embedded: 2, total_insights: 2, embedding_available: true};
  assert.deepEqual(evaluate({embedding: {dimensions: 1024}, status: healthy, expected: 1024}), {ok: true, problems: []});
  const mixed = evaluate({embedding: {dimensions: 768}, status: healthy, expected: 1024});
  assert.equal(mixed.ok, false);
  assert.match(mixed.problems.join('\n'), /重算/);
  const noVector = evaluate({embedding: {dimensions: 1024}, status: {...healthy, embedding_available: false}, expected: 1024});
  assert.match(noVector.problems.join('\n'), /不带向量/);
  const partial = evaluate({embedding: {dimensions: 1024}, status: {...healthy, coverage: '50%', embedded: 1}, expected: 1024});
  assert.match(partial.problems.join('\n'), /覆盖率/);
  const empty = evaluate({embedding: {dimensions: 1024}, status: {...healthy, coverage: '100%', embedded: 0, total_insights: 0}, expected: 1024});
  assert.match(empty.problems.join('\n'), /还没有任何条目/);
});

test('平台提示区分 Windows 与 macOS 的持久化方式', () => {
  const win = platformHints({platform: 'win32'}).join('\n');
  const mac = platformHints({platform: 'darwin'}).join('\n');
  assert.match(win, /SetEnvironmentVariable/);
  assert.match(win, /\$PROFILE/);
  assert.match(mac, /~\/\.zshrc/);
  assert.match(mac, /launchctl setenv/);
  assert.doesNotMatch(mac, /SetEnvironmentVariable/);
});

test('checkMnemonEmbedding 串起 CLI、端点与判定，且不触网', async () => {
  const run = () => ({status: 0, stdout: '{"coverage":"100%","embedded":1,"total_insights":1,"embedding_available":true}', stderr: ''});
  const report = await checkMnemonEmbedding({
    endpoint: DEFAULT_ENDPOINT,
    model: EMBED_MODEL,
    dataDir: '/tmp/mnemon',
    cli: {command: 'node', prefix: ['/opt/cli.js'], resolved: '/opt/cli.js'},
    fetchImpl: fakeFetch({models: [EMBED_MODEL], dims: 1024}),
    run,
  });
  assert.equal(report.ok, true);
  assert.equal(report.cli, '/opt/cli.js');
  assert.equal(report.status.total_insights, 1);
  await assert.rejects(checkMnemonEmbedding({cli: null}), /找不到 mnemon CLI/);
});
