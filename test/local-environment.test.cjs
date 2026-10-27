const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { pathToFileURL } = require("node:url"),
  { createRequire } = require("node:module");
const test = require("node:test"),
  assert = require("node:assert/strict");
const library = path.resolve(__dirname, "../plugins/local-environments/lib");
const values = import(pathToFileURL(path.join(library, "values.js")));
let z;
try {
  ({ z } = createRequire(
    path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@deepseek-ai/dsh/package.json",
    ),
  )("zod"));
} catch {}
const nativeTest = (name, body) =>
  test(name, { skip: !z && "Requires the pinned Harness Zod runtime" }, body);

test("environment values are literal data, case-safe, bounded and cannot replace managed facts", async () => {
  const { checkedVariables, mergeVariables } = await values;
  const selected = { BUILD_TAG: "red", Path: "selected" },
    explicit = { PATH: "caller", DSH_SESSION_ID: "owner" };
  assert.deepEqual(mergeVariables(selected, explicit, "win32"), {
    BUILD_TAG: "red",
    PATH: "caller",
    DSH_SESSION_ID: "owner",
  });
  assert.deepEqual(selected, { BUILD_TAG: "red", Path: "selected" });
  assert.deepEqual(
    checkedVariables({ TEXT: "$(not executed)\n`literal`", EMPTY: "" }),
    { TEXT: "$(not executed)\n`literal`", EMPTY: "" },
  );
  for (const invalid of [
    [],
    null,
    { DSH_SESSION_ID: "other" },
    { dsh_HOME: "other" },
    { Path: "a", PATH: "b" },
    { BAD: "a\0b" },
    { BAD: 4 },
    { "BAD-NAME": "x" },
  ])
    assert.throws(() => checkedVariables(invalid));
  const hostile = JSON.parse('{"__proto__":"literal"}');
  assert(Object.hasOwn(checkedVariables(hostile), "__proto__"));
  assert.equal({}.polluted, undefined);
});

test("native adapters keep per-call variables isolated, preserve explicit env and cancellation", async () => {
  const { environmentOverlay } = await values,
    calls = [];
  class Base {
    static Config = { native: true };
    static inject = ["subprocess", "sandbox"];
    constructor(ctx) {
      this.ctx = ctx;
    }
    get sandboxMode() {
      return "read-only";
    }
    execute(spec) {
      calls.push(spec);
      return Promise.resolve(spec);
    }
    spawnTerminal(spec) {
      calls.push(spec);
      return Promise.resolve(spec);
    }
    spawn(spec) {
      return spec;
    }
  }
  const ctx = {
    get: () => ({
      environmentFor: async (id) =>
        id === "A"
          ? { BUILD_TAG: "red" }
          : id === "B"
            ? { BUILD_TAG: "blue" }
            : undefined,
    }),
  };
  function adapter(file, name) {
    const code = fs
      .readFileSync(path.join(library, file), "utf8")
      .replace(/^import.*;\r?\n/gm, "")
      .replace("export default class", "class");
    const box = {
      SandboxPwshExecutor: Base,
      SandboxBashExecutor: Base,
      LocalSubprocessRuntime: Base,
      environmentOverlay,
    };
    vm.runInNewContext(code + "\nthis.Adapter=" + name, box);
    return new box.Adapter(ctx);
  }
  const shell = adapter("pwsh.js", "EnvironmentPwshExecutor"),
    terminal = adapter("subprocess.js", "EnvironmentSubprocessRuntime");
  const bash = adapter("bash.js", "EnvironmentBashExecutor");
  const policy = { mode: "read-only", root: "/fixture" };
  const bashResult = await bash.execute({ dshEnv: { DSH_SESSION_ID: "A" }, sandboxPolicy: policy });
  assert.equal(bashResult.env.BUILD_TAG, "red");
  assert.equal(bashResult.sandboxPolicy, policy);
  assert.equal(shell.sandboxMode, "read-only");
  assert.equal(shell.constructor.Config, Base.Config);
  const a = { dshEnv: { DSH_SESSION_ID: "A" }, env: { CALLER: "literal" } },
    b = { dshEnv: { DSH_SESSION_ID: "B" } };
  const [red, blue] = await Promise.all([shell.execute(a), shell.execute(b)]);
  assert.equal(red.env.BUILD_TAG, "red");
  assert.equal(blue.env.BUILD_TAG, "blue");
  assert.equal(a.env.BUILD_TAG, undefined);
  const ordinary = { dshEnv: { DSH_SESSION_ID: "C" } };
  assert.equal(await shell.execute(ordinary), ordinary);
  assert.equal(
    terminal.spawn(ordinary),
    ordinary,
    "Ordinary subprocess spawn must remain synchronous and native",
  );
  const pty = await terminal.spawnTerminal({
    env: { DSH_SESSION_ID: "A", BUILD_TAG: "caller" },
  });
  assert.equal(pty.env.BUILD_TAG, "caller");
  assert.equal(pty.env.DSH_SESSION_ID, "A");
  const controller = new AbortController();
  ctx.get = () => ({
    environmentFor: async () => {
      controller.abort();
      return { BUILD_TAG: "late" };
    },
  });
  const before = calls.length;
  await assert.rejects(
    shell.execute({
      dshEnv: { DSH_SESSION_ID: "A" },
      signal: controller.signal,
    }),
  );
  assert.equal(calls.length, before);
});

async function fixture(platform = process.platform) {
  const { checkedVariables } = await values,
    records = new Map(),
    selections = new Map(),
    sessions = new Map(),
    hooks = new Map();
  let reads = 0;
  const ctx = {
    credentials: {
      readRecord: async (key) => {
        reads++;
        return records.get(key);
      },
      modifyRecord: async (key, mutate) =>
        records.set(key, await mutate(records.get(key))),
    },
    sessionController: {
      projections: async ({ sessionId }) => ({
        kind: "sequenced",
        values: { localEnvironment: selections.get(sessionId) ?? null },
      }),
    },
    sessionProjections: { register: () => {} },
    sessions: { get: (id) => sessions.get(id), flush: async () => {} },
    nestedSessions: {
      list: async () => ({ links: [{ sessionId: "child", parentId: "root" }] }),
    },
    on: (event, fn) => hooks.set(event, fn),
  };
  const source = fs
    .readFileSync(path.join(library, "index.js"), "utf8")
    .replace(/^import.*;\r?\n/gm, "")
    .replace(/^export /gm, "");
  const definitions = { z, checkedVariables };
  vm.runInNewContext(
    fs
      .readFileSync(path.join(library, "definition.js"), "utf8")
      .replace(/^import.*;\r?\n/gm, "")
      .replace(/^export /gm, "") +
      "\nthis.shared={environmentId,repositoryKey,requiredVariables};",
    definitions,
  );
  const box = {
    ...definitions.shared,
    Service: class {
      constructor(context) {
        this.ctx = context;
      }
    },
    credentialKey: (scope, id) => scope + "/" + id,
    appendPluginRecord: (session, type, data) => session.append(type, data),
    z,
    checkedVariables,
    AbortSignal,
    process: { platform },
  };
  vm.runInNewContext(
    source + "\nthis.LocalEnvironments=LocalEnvironments;",
    box,
  );
  const service = new box.LocalEnvironments(ctx);
  const selection = {
    id: "env-one",
    name: "One",
    repositories: [
      {
        key: "repo",
        sourceRoot: "/fixture/repo",
        cwd: "/fixture/repo",
        worktree: false,
      },
    ],
    requiredVariables: ["BUILD_TAG"],
  };
  return {
    ctx,
    service,
    selection,
    records,
    selections,
    sessions,
    hooks,
    reads: () => reads,
  };
}

nativeTest(
  "selections keep values out of history/context, inherit by family and reread rotation",
  async () => {
    const f = await fixture();
    let event;
    await f.service.select(
      {
        append: (type, data) => {
          event = { type, data };
          f.selections.set("root", data);
        },
      },
      f.selection,
    );
    await f.service.setVariables("env-one", {
      BUILD_TAG: "private-one",
      EMPTY: "",
    });
    assert.equal((await f.service.environmentFor("root")).EMPTY, "");
    assert(!JSON.stringify(event).includes("private-one"));
    assert.equal(
      (await f.service.environmentFor("child")).BUILD_TAG,
      "private-one",
    );
    const first = f.reads();
    await f.service.setVariables("env-one", { BUILD_TAG: "private-two" });
    assert.equal(
      (await f.service.environmentFor("root")).BUILD_TAG,
      "private-two",
    );
    assert(f.reads() > first);
    assert.equal(await f.service.environmentFor("unrelated"), undefined);
    const result = await f.hooks.get("system-prompt/assemble")(
      {},
      { agent: { id: "root" }, signal: AbortSignal.timeout(1000) },
      async () => ({ contexts: [], tools: [], variables: {} }),
    );
    assert(!JSON.stringify(result).includes("private-two"));
    assert(result.contexts[0].text.includes("/fixture/repo"));
    await assert.rejects(
      f.service.select(
        {
          append: () => {
            throw Error("must not append");
          },
        },
        { ...f.selection, values: { BUILD_TAG: "secret" } },
      ),
    );
  },
);

nativeTest(
  "fresh native subagents inherit the owning session and malformed required names reject",
  async () => {
    const f = await fixture();
    f.selections.set("root", f.selection);
    await f.service.setVariables("env-one", { BUILD_TAG: "native-child" });
    f.sessions.set("native-child", {
      header: { origin: "subagent", parentSession: "root" },
    });
    assert.equal(
      (await f.service.environmentFor("native-child"))?.BUILD_TAG,
      "native-child",
    );
    await assert.rejects(
      f.service.select(
        { append() {} },
        { ...f.selection, requiredVariables: ["DSH_HOME"] },
      ),
    );
  },
);

nativeTest(
  "required variable names follow the operating system case rules",
  async () => {
    for (const platform of ["win32", "linux"]) {
      const f = await fixture(platform);
      f.selections.set("root", f.selection);
      await f.service.setVariables("env-one", { build_tag: "value" });
      if (platform === "win32")
        assert.equal(
          (await f.service.environmentFor("root")).build_tag,
          "value",
        );
      else
        await assert.rejects(
          f.service.environmentFor("root"),
          /not configured/,
        );
    }
  },
);

nativeTest(
  "missing values and cancelled reads fail before execution",
  async () => {
    const f = await fixture();
    f.selections.set("root", f.selection);
    await assert.rejects(f.service.environmentFor("root"), /not configured/);
    for (const record of [
      { kind: "api-key", env: { BUILD_TAG: "wrong record" } },
      { kind: "grant", payload: { version: 2, variables: {} } },
      {
        kind: "grant",
        payload: { version: 1, variables: { DSH_HOME: "wrong" } },
      },
    ]) {
      f.ctx.credentials.readRecord = async () => record;
      await assert.rejects(f.service.environmentFor("root"));
    }
    const controller = new AbortController();
    f.ctx.credentials.readRecord = async () => {
      controller.abort();
      return {
        kind: "grant",
        payload: { version: 1, variables: { BUILD_TAG: "late" } },
      };
    };
    await assert.rejects(f.service.environmentFor("root", controller.signal));
  },
);
