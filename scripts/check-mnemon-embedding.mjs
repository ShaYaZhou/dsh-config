import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// 只读体检：Ollama 端点、嵌入模型维度、mnemon CLI 的覆盖率。
// 不写配置、不改数据、不安装任何东西；Windows 与 macOS 走同一份逻辑。

export const EMBED_MODEL = 'qwen3-embedding:0.6b';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const KNOWN_DIMS = {'qwen3-embedding:0.6b': 1024, 'qwen3-embedding:4b': 2560, 'qwen3-embedding:8b': 4096, 'nomic-embed-text': 768};

export function expectedDims(model) {
  return KNOWN_DIMS[model] ?? KNOWN_DIMS[model.split(':')[0]] ?? null;
}

export function dshHome({env = process.env, home = os.homedir()} = {}) {
  return env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home, '.dsh');
}

export function cliCandidates({env = process.env, home = os.homedir()} = {}) {
  const root = dshHome({env, home});
  const candidates = [];
  if (env.MNEMON_CLI_JS) candidates.push(path.resolve(env.MNEMON_CLI_JS));
  for (const profile of ['desktop', 'headless']) {
    candidates.push(path.join(root, 'profiles', profile, 'node_modules', '@mnemon-dev', 'mnemon', 'bin', 'mnemon.js'));
  }
  return candidates;
}

// 优先使用 DSH profile 内的 CLI（与插件同版），其次 PATH 上的全局命令。
export function resolveCli({env = process.env, home = os.homedir(), exists = fs.existsSync, which = whichCommand} = {}) {
  for (const candidate of cliCandidates({env, home})) {
    if (exists(candidate)) return {kind: 'node', command: process.execPath, prefix: [candidate], resolved: candidate};
  }
  const onPath = which('mnemon');
  if (onPath) return {kind: 'binary', command: onPath, prefix: [], resolved: onPath};
  return null;
}

export function whichCommand(name) {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name],
    {encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false});
  if (probe.status !== 0) return null;
  const first = (probe.stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0];
  return first || null;
}

const KNOWN_FLAGS = new Set(['endpoint', 'model', 'data-dir', 'timeout-ms']);

export function parseArgs(argv) {
  const out = {endpoint: DEFAULT_ENDPOINT, model: EMBED_MODEL, dataDir: null, timeoutMs: 15000};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error('未知参数: ' + arg);
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!KNOWN_FLAGS.has(key)) throw new Error('未知参数: --' + key);
    const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new Error('参数缺少取值: --' + key);
    if (key === 'endpoint') out.endpoint = value;
    else if (key === 'model') out.model = value;
    else if (key === 'data-dir') out.dataDir = value;
    else if (key === 'timeout-ms') out.timeoutMs = Number(value);
    else throw new Error('未知参数: --' + key);
  }
  if (!out.dataDir) out.dataDir = path.join(dshHome(), 'mnemon');
  return out;
}

function normalizeModelName(name) {
  return String(name ?? '').replace(/:latest$/, '');
}

export async function probeEmbedding({endpoint = DEFAULT_ENDPOINT, model = EMBED_MODEL, timeoutMs = 15000, fetchImpl = fetch} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const tagsUrl = new URL('/api/tags', endpoint);
  let tags;
  try {
    tags = await fetchImpl(tagsUrl, {signal});
  } catch (error) {
    throw new Error('无法连接 Ollama 端点 ' + endpoint + '（' + (error.code ?? error.name) + '）。先启动 ollama serve，核对配置里的 embedding.endpoint。');
  }
  if (!tags.ok) throw new Error('Ollama ' + tagsUrl.pathname + ' 返回 HTTP ' + tags.status + '。');
  const models = ((await tags.json()).models ?? []).map(entry => normalizeModelName(entry.name));
  if (!models.includes(normalizeModelName(model))) {
    throw new Error('Ollama 上没有模型 ' + model + '。执行 `ollama pull ' + model + '` 后重试；已安装: ' + (models.join(', ') || '（无）'));
  }
  const embedUrl = new URL('/api/embed', endpoint);
  const response = await fetchImpl(embedUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({model, input: 'mnemon embedding self check'}),
    signal,
  });
  if (!response.ok) throw new Error('Ollama ' + embedUrl.pathname + ' 返回 HTTP ' + response.status + '，模型 ' + model + ' 不可用于嵌入。');
  const vector = (await response.json()).embeddings?.[0];
  if (!Array.isArray(vector) || vector.length === 0) throw new Error('Ollama 未返回向量，无法确认 ' + model + ' 的维度。');
  return {endpoint, model, dimensions: vector.length, models};
}

export function runEmbedStatus({cli, dataDir, model, run = spawnSync, platform = process.platform}) {
  const args = [...cli.prefix, '--data-dir', dataDir, '--embed-model', model, 'embed', '--status'];
  const result = run(cli.command, args, {encoding: 'utf8', timeout: 60000, windowsHide: platform === 'win32', shell: false});
  if (result.error) throw new Error('无法运行 mnemon CLI（' + result.error.message + '）。设置 MNEMON_CLI_JS 指向 bin/mnemon.js。');
  if (result.status !== 0) throw new Error('mnemon embed --status 退出码 ' + result.status + '：' + (result.stderr ?? '').trim());
  const text = String(result.stdout ?? '');
  const start = text.indexOf('{');
  if (start === -1) throw new Error('mnemon embed --status 没有返回 JSON：' + text.slice(0, 200));
  return JSON.parse(text.slice(start));
}

// 纯判定：便于在无网络、无 Ollama 的环境里回归。
export function evaluate({embedding, status, expected}) {
  const problems = [];
  const dims = embedding?.dimensions ?? null;
  if (!dims) problems.push('没有拿到嵌入维度，无法确认向量可用。');
  else if (expected && dims !== expected) problems.push('模型维度是 ' + dims + '，按模型约定应为 ' + expected + '；旧的异维向量必须重算，否则相似度失去意义。');
  if (status && status.embedding_available !== true) problems.push('mnemon 报告 embedding_available=false，写入仍会成功但不带向量，语义召回漏掉新条目。');
  const coverage = typeof status?.coverage === 'string' ? status.coverage.replace(/%$/, '') : null;
  if (coverage !== null && Number(coverage) < 100) problems.push('向量覆盖率只有 ' + status.coverage + '（' + status.embedded + '/' + status.total_insights + '），在记忆空间点「补齐」或对单条执行 mnemon embed <id>。');
  if (status && Number(status.total_insights) === 0) problems.push('记忆空间里还没有任何条目，覆盖率不能说明链路正常；先写入一条再复查。');
  return {ok: problems.length === 0, problems};
}

export function platformHints({platform = process.platform, model = EMBED_MODEL} = {}) {
  if (platform === 'win32') {
    return [
      'Windows 兜底：`[Environment]::SetEnvironmentVariable("MNEMON_EMBED_MODEL","' + model + '","User")`，重启后对所有新进程生效。',
      'Windows 交互终端还可在 $PROFILE 里定义 mnemon 函数，固定注入 --data-dir 与 --embed-model。',
    ];
  }
  return [
    'macOS 兜底：`export MNEMON_EMBED_MODEL=' + model + '` 写入 ~/.zshrc（或 ~/.bash_profile）。',
    'macOS 由 Finder/启动台拉起的应用不继承 shell 变量：GUI 场景用 `launchctl setenv MNEMON_EMBED_MODEL ' + model + '`（重启登录后失效）或始终显式传 --embed-model。',
  ];
}

export async function checkMnemonEmbedding(options = {}) {
  const settings = {...parseArgs([]), ...options};
  const cli = 'cli' in options ? options.cli : resolveCli();
  if (!cli) throw new Error('找不到 mnemon CLI。设置 MNEMON_CLI_JS，或确认 $DSH_HOME/profiles/desktop/node_modules/@mnemon-dev/mnemon/bin/mnemon.js 存在，或 `npm install -g @mnemon-dev/mnemon`。');
  const embedding = await probeEmbedding({endpoint: settings.endpoint, model: settings.model, timeoutMs: settings.timeoutMs, fetchImpl: options.fetchImpl});
  const status = runEmbedStatus({cli, dataDir: settings.dataDir, model: settings.model, run: options.run});
  const expected = expectedDims(settings.model);
  const verdict = evaluate({embedding, status, expected});
  return {cli: cli.resolved, embedding, status, expected, ...verdict};
}

function printReport(report, {platform = process.platform, model = EMBED_MODEL} = {}) {
  console.log('CLI: ' + report.cli);
  console.log('端点: ' + report.embedding.endpoint + '  模型: ' + report.embedding.model + '  维度: ' + report.embedding.dimensions + (report.expected ? '（约定 ' + report.expected + '）' : ''));
  console.log('覆盖率: ' + (report.status.coverage ?? '?') + '  已嵌入: ' + report.status.embedded + '/' + report.status.total_insights + '  embedding_available: ' + report.status.embedding_available);
  if (report.ok) {
    const envModel = process.env.MNEMON_EMBED_MODEL;
    console.log('MNEMON_EMBEDDING_OK 向量链路可用；当前进程 MNEMON_EMBED_MODEL=' + (envModel || '（未继承，用户级变量对新进程才生效）'));
  } else {
    for (const problem of report.problems) console.log('- ' + problem);
    for (const hint of platformHints({platform, model})) console.log('* ' + hint);
    console.log('MNEMON_EMBEDDING_FAIL');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkMnemonEmbedding(parseArgs(process.argv.slice(2)))
    .then(report => {
      printReport(report);
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
