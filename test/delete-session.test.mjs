import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { relocateSession } from '../plugins/delete-session/lib/trash.js';

const STAMP = '2026-10-23T03-42-42-113Z';

// 原生协议包只在装了固定版本 Harness 的机器上可解析；干净克隆里跳过这条，其余测试照跑。
let nativeRequire;
try {
  nativeRequire = createRequire(path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/package.json'));
  nativeRequire.resolve('@deepseek-ai/dsh-typert-protocol');
} catch {
  nativeRequire = undefined;
}
const nativeTest = (name, body) =>
  test(name, { skip: !nativeRequire && 'Requires the pinned Harness runtime' }, body);

async function fixture() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-delete-session-'));
  const sessionDir = path.join(home, 'sessions', 'proj-a', 'sess-1');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'synthetic');
  return { home, sessionDir };
}

test('moves the stored session directory into the trash and keeps its contents', async () => {
  const { home, sessionDir } = await fixture();
  try {
    const result = await relocateSession(home, 'sess-1', STAMP);
    const target = path.join(home, 'dsh-delete-session-trash', `sess-1-${STAMP}`);
    assert.deepEqual(result, { moved: true, trashedTo: target });
    await assert.rejects(fs.stat(sessionDir), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(target, 'session.v4.jsonl.zstd'), 'utf8'), 'synthetic');
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

nativeTest('the delete endpoint is marked on the prototype at load time', async () => {
  const { Remote } = await import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/dsh-typert-protocol')).href);
  const code = fsSync
    .readFileSync(new URL('../plugins/delete-session/lib/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const chain = new Proxy({}, { get: () => () => chain });
  const box = {
    z: { string: () => chain, strictObject: (shape) => shape },
    sessionId: chain,
    runInitializers: (target, initializers) => {
      for (const initialize of initializers) initialize.call(target);
    },
    Remote,
    TypertRemoteService: class {
      constructor(ctx, key) {
        this.ctx = ctx;
        this.key = key;
      }
    },
    resolveDshHome: () => '/tmp/dsh-home',
    relocateSession: async () => ({ moved: true }),
  };
  vm.createContext(box);
  vm.runInContext(code + '\nthis.DeleteSession = DeleteSession;this.apply = apply;', box);
  const descriptor = Object.getOwnPropertyDescriptor(
    box.DeleteSession.prototype,
    '@deepseek-ai/dsh-typert-protocol/remote-methods',
  );
  assert.ok(descriptor, '没有执行 addInitializer，端点标记就没写到原型上，Gateway 会返回 404');
  assert.deepEqual(descriptor.value.methods.map((method) => method.method), ['delete']);
  assert.equal(typeof descriptor.value.methods[0].resources.session, 'function');
  assert.equal(descriptor.value.methods[0].resources.session({ sessionId: 's1' }), 's1');
});

// 服务端准入用一个最小 ctx：waterfall 回答活动清单，workspaceRegistry 回答归档集合。
// activity 可以是一份固定清单，也可以是一份按轮次变化的清单（每轮取一项，用尽后沿用最后一项），
// 用来模拟归档后子代理还在退出、几拍之后才清空。
function admissionBox({ activity = [], archived = [] } = {}) {
  const code = fsSync
    .readFileSync(new URL('../plugins/delete-session/lib/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const calls = [];
  const rounds = Array.isArray(activity[0]) ? activity : null;
  const sleeps = [];
  let round = 0;
  const chain = new Proxy({}, { get: () => () => chain });
  const box = {
    z: { string: () => chain, strictObject: (shape) => shape },
    sessionId: chain,
    runInitializers: (target, initializers) => {
      for (const initialize of initializers) initialize.call(target);
    },
    Remote: () => () => {},
    TypertRemoteService: class {
      constructor(ctx) {
        this.ctx = ctx;
      }
    },
    resolveDshHome: () => '/tmp/dsh-home',
    relocateSession: async (home, id) => {
      calls.push({ home, id });
      return { moved: true, trashedTo: 'trash' };
    },
    // vm 上下文没有宿主定时器；立即兑现，让等待轮询在测试里瞬间跑完。
    setTimeout: (resolve, ms) => {
      sleeps.push(ms);
      resolve();
    },
  };
  vm.createContext(box);
  vm.runInContext(code + '\nthis.DeleteSession = DeleteSession;', box);
  const ctx = {
    workspaceRegistry: { archivedSessionIds: archived },
    waterfall: async (event, request) => {
      calls.push({ event, request });
      if (!rounds) return activity;
      return rounds[Math.min(round++, rounds.length - 1)];
    },
  };
  return { DeleteSession: box.DeleteSession, ctx, calls, sleeps };
}

test('the server waits for a stopping subagent to clear, then moves the session', async () => {
  const { DeleteSession, ctx, calls, sleeps } = admissionBox({
    activity: [[{ kind: 'subagent' }], [{ kind: 'subagent' }], []],
    archived: ['sess-1'],
  });
  assert.deepEqual(await new DeleteSession(ctx).delete({ sessionId: 'sess-1' }), {
    moved: true,
    trashedTo: 'trash',
  });
  assert.deepEqual(sleeps, [200, 200]);
  assert.deepEqual(calls.at(-1), { home: '/tmp/dsh-home', id: 'sess-1' });
});

test('the server gives up instead of looping when activity never clears', async () => {
  const { DeleteSession, ctx, calls, sleeps } = admissionBox({
    activity: [{ kind: 'turn' }],
    archived: ['sess-1'],
  });
  await assert.rejects(new DeleteSession(ctx).delete({ sessionId: 'sess-1' }), /仍在停止中/);
  assert.equal(sleeps.length, 50);
  assert.equal(calls.some((call) => call.id), false);
});

test('the server refuses to delete a session that is not archived', async () => {
  const { DeleteSession, ctx, calls } = admissionBox({ archived: [] });
  await assert.rejects(new DeleteSession(ctx).delete({ sessionId: 'sess-1' }), /尚未归档/);
  assert.equal(calls.some((call) => call.id), false);
});

test('the server moves only an archived, inactive session', async () => {
  const { DeleteSession, ctx, calls } = admissionBox({ archived: ['sess-1'] });
  assert.deepEqual(await new DeleteSession(ctx).delete({ sessionId: 'sess-1' }), {
    moved: true,
    trashedTo: 'trash',
  });
  assert.deepEqual(calls.at(-1), { home: '/tmp/dsh-home', id: 'sess-1' });
});

test('reports a missing session without creating trash state', async () => {
  const { home } = await fixture();
  try {
    assert.deepEqual(await relocateSession(home, 'absent', STAMP), { moved: false, trashedTo: null });
    await assert.rejects(fs.stat(path.join(home, 'dsh-delete-session-trash')), { code: 'ENOENT' });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
