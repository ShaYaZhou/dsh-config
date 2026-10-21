const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const vm = require("node:vm"),
  { createRequire } = require("node:module");
const test = require("node:test"),
  assert = require("node:assert/strict");
const library = path.resolve(__dirname, "../plugins/local-environments/lib");
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

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-env-catalog-"));
  t.after(() => {
    assert(
      fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep),
    );
    fs.rmSync(root, { recursive: true });
  });
  const values = await import(
    require("node:url").pathToFileURL(path.join(library, "values.js"))
  );
  const nativeRequire = createRequire(
    path.join(
      process.env.APPDATA,
      "npm/node_modules/@deepseek-ai/dsh/package.json",
    ),
  );
  const { Remote, principalOf } = await import(
    require("node:url").pathToFileURL(
      nativeRequire.resolve("@deepseek-ai/dsh-typert-protocol"),
    )
  );
  const box = {
    z,
    checkedVariables: values.checkedVariables,
    AbortSignal,
    path,
    realpath: fs.promises.realpath,
    stat: fs.promises.stat,
    defineDomain: (spec) => spec,
    Remote,
    RemoteError: class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
    TypertRemoteService: class {
      constructor(ctx) {
        this.ctx = ctx;
      }
    },
    principalOf,
  };
  vm.createContext(box);
  const read = (name) =>
    fs
      .readFileSync(path.join(library, name), "utf8")
      .replace(/^import[^;]*;\r?\n/gm, "")
      .replace(/^export /gm, "");
  vm.runInContext(
    read("definition.js") + "\nthis.portable=portableSchema;",
    box,
  );
  vm.runInContext(
    read("catalog.js") +
      "\nthis.Catalog=LocalEnvironmentCatalog;this.specification=spec;",
    box,
  );
  let state = { definitions: [], bindings: {} };
  const calls = [],
    agents = new Map();
  const domain = {
    global: {
      get: () => state,
      set: async (value) => {
        state = box.specification.global.schema.parse(value);
      },
    },
  };
  const ctx = {
    localEnvironments: {
      setVariables: async (id, value) =>
        calls.push({ kind: "variables", id, value }),
      configuredValues: async (id, required) =>
        calls.push({ kind: "configured", id, required }),
      select: async (session, selection) =>
        calls.push({ kind: "selection", id: session.id, selection }),
    },
    workspaceRegistry: {
      create: async (cwd) => ({ id: cwd }),
      archiveSession: async (sessionId) =>
        calls.push({ kind: "archive", sessionId }),
      list: () => [],
    },
    sessionController: {
      create: async (request) => {
        calls.push({ kind: "create", request });
        const id = "session-" + agents.size;
        agents.set(id, {
          id,
          cwd: request.cwd ?? request.workspaceId,
          session: { id },
        });
        return { sessionId: id };
      },
      resolveAgent: async (id) => ({ agent: agents.get(id) }),
      rename: async () => {},
      list: async () => ({ items: [] }),
    },
    subprocess: {
      spawn: (request) => {
        calls.push({ kind: "git", request });
        const last = request.argv.at(-1);
        return {
          done: Promise.resolve({ exitCode: last.includes("missing") ? 1 : 0 }),
          collected: {
            stdout: {
              readFrom: () => ({
                text: last === "--show-toplevel" ? request.cwd : "a".repeat(40),
                lossy: false,
              }),
            },
          },
        };
      },
    },
    worktrees: {
      create: async (agent, request) => {
        calls.push({ kind: "worktree", cwd: agent.cwd, request });
        const cwd = path.join(
          root,
          "tree-" + calls.filter((call) => call.kind === "worktree").length,
        );
        fs.mkdirSync(cwd);
        return {
          path: cwd,
          branch: "branch",
          repositoryRoot: agent.cwd,
          baseCommit: request.from,
        };
      },
    },
  };
  const service = new box.Catalog(ctx, domain);
  const definition = {
    id: "project-one",
    name: "One",
    repositories: [{ key: "web", mode: "checkout" }],
    requiredVariables: ["BUILD_TAG"],
  };
  return {
    root,
    ctx,
    service,
    calls,
    definition,
    state: () => state,
    portable: box.portable,
  };
}

nativeTest(
  "owner-only environment definitions export without host bindings or variable values",
  async (t) => {
    const f = await fixture(t);
    await f.service.save(f.definition);
    await f.service.bind({ id: f.definition.id, key: "web", path: f.root });
    await f.service.variables({
      id: f.definition.id,
      values: { BUILD_TAG: "private" },
    });
    const exported = await f.service.export();
    assert(!JSON.stringify(exported).includes(f.root));
    assert(!JSON.stringify(exported).includes("private"));
    assert.equal(exported.environments[0].requiredVariables[0], "BUILD_TAG");
    assert.throws(() =>
      f.portable.parse({ ...exported, bindings: f.state().bindings }),
    );
    f.ctx.invocation = { peer: { principal: { kind: "agent" } } };
    for (const method of [
      "list",
      "export",
      "recent",
      "save",
      "bind",
      "variables",
      "launch",
      "import",
      "remove",
      "openFolder",
    ])
      await assert.rejects(f.service[method]({}), /Only the local owner/);
  },
);

nativeTest(
  "portable imports merge definitions, preserve per-environment bindings and reject unknown fields",
  async (t) => {
    const f = await fixture(t);
    await f.service.save(f.definition);
    await f.service.bind({ id: "project-one", key: "web", path: f.root });
    const second = { ...f.definition, id: "project-two", name: "Two" };
    await f.service.import({ version: 1, environments: [second] });
    const other = path.join(f.root, "other");
    fs.mkdirSync(other);
    await f.service.bind({ id: "project-two", key: "web", path: other });
    assert.equal(f.state().bindings["project-one"].web, f.root);
    assert.equal(f.state().bindings["project-two"].web, other);
    await assert.rejects(
      f.service.save({ ...second, values: { TOKEN: "not portable" } }),
    );
    await assert.rejects(
      f.service.save({
        ...second,
        repositories: [{ key: "web", mode: "checkout", baseRef: "main" }],
      }),
    );
    await assert.rejects(
      f.service.save({
        ...second,
        repositories: [second.repositories[0], second.repositories[0]],
      }),
    );
    await assert.rejects(
      f.service.save({ ...second, requiredVariables: ["DSH_HOME"] }),
    );
    await assert.rejects(
      f.service.import({ version: 1, environments: [second, second] }),
    );
    await f.service.remove({ id: "project-one" });
    assert.equal(f.state().definitions.length, 1);
    assert.equal(f.state().bindings["project-one"].web, f.root);
    assert.equal(f.calls.filter((call) => call.kind === "archive").length, 0);
  },
);

nativeTest(
  "launch preflights every repository and missing variable before native worktree effects",
  async (t) => {
    const f = await fixture(t);
    const definition = {
      ...f.definition,
      repositories: [
        { key: "web", mode: "worktree", baseRef: "main" },
        { key: "api", mode: "worktree", baseRef: "missing" },
      ],
    };
    await f.service.save(definition);
    await f.service.bind({ id: definition.id, key: "web", path: f.root });
    await assert.rejects(
      f.service.launch({ id: definition.id }),
      /Bind a local folder for api/,
    );
    assert(
      !f.calls.some(
        (call) => call.kind === "create" || call.kind === "worktree",
      ),
    );
    const other = path.join(f.root, "other");
    fs.mkdirSync(other);
    await f.service.bind({ id: definition.id, key: "api", path: other });
    await assert.rejects(
      f.service.launch({ id: definition.id }),
      /reference cannot be resolved/,
    );
    assert(
      !f.calls.some(
        (call) => call.kind === "create" || call.kind === "worktree",
      ),
    );
    await f.service.save({
      ...definition,
      repositories: definition.repositories.map((repo) => ({
        ...repo,
        baseRef: "main",
      })),
    });
    f.ctx.localEnvironments.configuredValues = async () => {
      throw new Error("missing variable");
    };
    await assert.rejects(
      f.service.launch({ id: definition.id }),
      /missing variable/,
    );
    assert(
      !f.calls.some(
        (call) => call.kind === "create" || call.kind === "worktree",
      ),
    );
  },
);

nativeTest(
  "launch pins native worktrees, keeps their preparation history and selects only metadata in a new conversation",
  async (t) => {
    const f = await fixture(t);
    await f.service.save({
      ...f.definition,
      repositories: [{ key: "web", mode: "worktree", baseRef: "main" }],
    });
    await f.service.bind({ id: f.definition.id, key: "web", path: f.root });
    const result = await f.service.launch({ id: f.definition.id });
    assert.equal(f.calls.filter((call) => call.kind === "worktree").length, 1);
    assert.equal(
      f.calls.find((call) => call.kind === "worktree").request.from,
      "a".repeat(40),
    );
    const selected = f.calls.find((call) => call.kind === "selection");
    assert.equal(selected.id, result.sessionId);
    assert.equal(
      selected.selection.repositories[0].cwd,
      result.repositories[0].cwd,
    );
    assert.equal(selected.selection.repositories[0].sourceRoot, f.root);
    assert(!Object.hasOwn(selected.selection.repositories[0], "commit"));
    assert.equal(f.calls.filter((call) => call.kind === "archive").length, 1);
    assert(!f.calls.some((call) => call.kind === "variables"));
  },
);

nativeTest(
  "clearing a saved folder unbinds it and cannot silently launch its old directory",
  async (t) => {
    const f = await fixture(t);
    await f.service.save(f.definition);
    await f.service.bind({ id: f.definition.id, key: "web", path: f.root });
    await f.service.bind({ id: f.definition.id, key: "web", path: null });
    assert(!Object.hasOwn(f.state().bindings[f.definition.id], "web"));
    await assert.rejects(
      f.service.launch({ id: f.definition.id }),
      /Bind a local folder/,
    );
    assert(!f.calls.some((call) => call.kind === "create"));
  },
);

nativeTest(
  "partial launch failure retains artifacts and reports session identities without removing history",
  async (t) => {
    const f = await fixture(t);
    await f.service.save({
      ...f.definition,
      repositories: [{ key: "web", mode: "worktree" }],
    });
    await f.service.bind({ id: f.definition.id, key: "web", path: f.root });
    f.ctx.worktrees.create = async () => {
      throw new Error("native failure");
    };
    await assert.rejects(
      f.service.launch({ id: f.definition.id }),
      /retained session IDs: session-0.*native failure/,
    );
    assert(
      !f.calls.some(
        (call) => call.kind === "archive" || call.kind === "selection",
      ),
    );
  },
);

nativeTest(
  "recent folders use native metadata without activating sessions and opening validates the live folder",
  async (t) => {
    const f = await fixture(t);
    f.ctx.workspaceRegistry.list = () => [
      { path: f.root, title: "Root", createdAt: new Date(1).toISOString() },
    ];
    const missing = path.join(f.root, "missing");
    f.ctx.sessionController.list = async () => ({
      items: [
        { cwd: missing, updatedAt: 5 },
        { cwd: f.root, updatedAt: 3 },
        { cwd: f.root, updatedAt: 2 },
      ],
    });
    const rows = await f.service.recent();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].path, missing);
    assert.equal(rows[0].available, false);
    assert.equal(rows[1].title, "Root");
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.service.openFolder({ path: missing }));
    await assert.rejects(f.service.openFolder({ path: "relative" }));
    assert.equal(f.calls.length, 0);
    const opened = await f.service.openFolder({ path: f.root });
    assert.equal(opened.sessionId, "session-0");
  },
);
