const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { createRequire } = require("node:module"),
  { pathToFileURL } = require("node:url"),
  { randomUUID } = require("node:crypto");
const test = require("node:test"),
  assert = require("node:assert/strict");
const library = path.resolve(__dirname, "../plugins/follow-ups/lib");
let nativeRequire;
try {
  nativeRequire = createRequire(
    path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@deepseek-ai/dsh/package.json",
    ),
  );
  nativeRequire.resolve("zod");
} catch {
  nativeRequire = undefined;
}
const nativeTest = (name, body) =>
  test(
    name,
    { skip: !nativeRequire && "Requires the pinned Harness runtime" },
    body,
  );

async function fixture() {
  const { z } = nativeRequire("zod");
  const protocol = await import(
    pathToFileURL(nativeRequire.resolve("@deepseek-ai/dsh-typert-protocol"))
  );
  const states = new Map(),
    preferences = new Map(),
    agents = new Map(),
    events = [],
    effects = [];
  let service,
    id = 0;
  const input = {
    tasks: [
      { title: "Task A", prompt: "Follow-up A" },
      { title: "Task B", prompt: "Follow-up B" },
    ],
    nextPrompt: "Review the result",
  };
  const root = {
    id: "session-root",
    status: "running",
    inbox: { nextTurn: [], nextStep: [] },
    session: { id: "session-root", header: {} },
  };
  agents.set(root.id, root);
  const ctx = {
    sessionProjections: {
      register: () => {},
      stateOf: (session) => states.get(session.id) ?? box.initialState(),
    },
    sessionController: {
      projections: async ({ sessionId }) => {
        effects.push({ kind: "read", sessionId });
        return {
          kind: "sequenced",
          values: { followUps: states.get(sessionId) ?? box.initialState() },
        };
      },
      resolveAgent: async (sessionId) => {
        effects.push({ kind: "resolve", sessionId });
        return { agent: agents.get(sessionId) };
      },
      prompt: async (request) => {
        effects.push({ kind: "human-prompt", request });
        event(root, "user/message", {
          source: { kind: "user", rpcId: request.requestId },
        });
        return { accepted: true };
      },
    },
    nestedSessions: {
      list: async () => ({ links: [] }),
      start: async (request) => {
        effects.push({ kind: "child", request });
        const childId = "session-child-" + ++id;
        const child = {
          id: childId,
          session: { id: childId, header: {} },
          inbox: { nextTurn: [], nextStep: [] },
        };
        agents.set(childId, child);
        return { sessionId: childId };
      },
      sendWithSignal: async (request, signal) => {
        signal.throwIfAborted();
        effects.push({ kind: "dispatch", request });
        return { delivered: true };
      },
    },
    agents: { get: (id) => agents.get(id) },
    sessions: { flush: async () => {} },
    workspaceRegistry: {
      archivedSessionIds: [],
      archiveSession: async (id) => effects.push({ kind: "archive", id }),
    },
    workingDirectory: { get: () => "/project" },
    permissionPresets: { current: () => "workspace-write" },
    localEnvironments: {
      selectionFor: async () => undefined,
      environmentFor: async () => undefined,
      select: async (session, selection) =>
        effects.push({ kind: "environment", sessionId: session.id, selection }),
    },
    logger: { warn: (message) => effects.push({ kind: "warning", message }) },
  };
  function event(agent, type, data, rest = {}) {
    const row = { type, data, seq: events.length, ...rest };
    states.set(
      agent.id,
      box.fold(states.get(agent.id) ?? box.initialState(), row),
    );
    events.push({ ...row, sessionId: agent.id });
    service?.observe(agent.session, row);
  }
  const box = {
    z,
    sessionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/),
    runInitializers: (target, initializers) => {
      for (const initialize of initializers) initialize.call(target);
    },
    Remote: protocol.Remote,
    RemoteError: protocol.RemoteError,
    principalOf: protocol.principalOf,
    TypertRemoteService: class {
      constructor(ctx) {
        this.ctx = ctx;
      }
    },
    defineDomain: (spec) => spec,
    domainTable: (schema) => schema,
    randomUUID,
    AbortSignal,
    AbortController,
    defineTool: (tool) => tool,
    appendPluginRecord: (session, type, data) =>
      event(agents.get(session.id), type, data, { ignorable: true }),
    preflightRepositories: async (_ctx, inputs, signal) => {
      signal.throwIfAborted();
      effects.push({ kind: "preflight", inputs });
      return inputs.map((repo) => ({
        key: repo.key,
        sourceRoot: repo.path,
        cwd: repo.path,
        worktree: true,
        commit: "a".repeat(40),
      }));
    },
    createRepositoryWorkspaces: async (_ctx, planned, signal, options) => {
      signal.throwIfAborted();
      effects.push({ kind: "prepare", options });
      return {
        repositories: planned.map((repo) => ({
          ...repo,
          cwd: "/isolated/" + randomUUID(),
          branch: "new-branch",
        })),
        preparationSessionIds: Object.values(options.sessionIds),
      };
    },
  };
  vm.createContext(box);
  const read = (file) =>
    fs
      .readFileSync(path.join(library, file), "utf8")
      .replace(/^import[^;]*;\r?\n/gm, "")
      .replace(/^export /gm, "");
  vm.runInContext(
    read("state.js") +
      "\nthis.fold=fold;this.initialState=initialState;this.inputSchema=proposalInput;this.recordTypes=records;",
    box,
  );
  vm.runInContext(
    read("index.js") + "\nthis.FollowUps=FollowUps;this.install=apply;",
    box,
  );
  const config = { promptSuggestions: { get: () => true } };
  let preferenceRevision = 0;
  const domain = {
    global: {
      get: () => ({
        promptSuggestions: config.promptSuggestions.get(),
        revision: preferenceRevision,
      }),
      set: async (value) => {
        config.promptSuggestions.get = () => value.promptSuggestions;
        preferenceRevision = value.revision;
      },
    },
    table: () => ({
      get: (id) => preferences.get(id),
      put: async (id, value) => preferences.set(id, value),
    }),
  };
  service = new box.FollowUps(ctx, domain);
  const propose = () => service.propose(root, input, AbortSignal.timeout(1000));
  const offer = () => states.get(root.id)?.offer;
  const accept = (
    mode = "isolated",
    ids = offer().tasks.map((task) => task.id),
  ) =>
    service.accept({
      sessionId: root.id,
      offerId: offer().id,
      taskIds: ids,
      mode,
    });
  return {
    ctx,
    service,
    root,
    input,
    config,
    states,
    preferences,
    effects,
    events,
    box,
    event,
    propose,
    offer,
    accept,
    restart: () => {
      service = new box.FollowUps(ctx, domain);
      return service;
    },
  };
}

nativeTest(
  "the advertised tool parameters compile with the real native value-schema DSL",
  async () => {
    const f = await fixture();
    const nativeTools = await import(
      pathToFileURL(nativeRequire.resolve("@deepseek-ai/dsh-tools"))
    );
    let registered;
    const lifecycle = [];
    f.ctx.storage = {
      domain: {
        open: async () => ({
          global: { get: () => ({ promptSuggestions: true, revision: 0 }) },
          table: () => ({ get() {}, put: async () => {} }),
          close: async () => {},
        }),
      },
    };
    f.ctx.on = () => () => {};
    f.ctx.effect = (effect) => lifecycle.push(effect);
    f.ctx.agents.list = () => [f.root];
    f.root.ctx = {
      tools: {
        register: (tool) => {
          registered = nativeTools.parameterSchemaSpecToJsonSchema(
            tool.parameters,
          );
          nativeTools.valueSchemaSpecToJsonSchema(tool.output.schema);
          return () => {};
        },
      },
      systemPrompt: { context: () => () => {} },
    };
    await f.box.install(f.ctx);
    assert.deepEqual(Array.from(registered.properties.tasks.items.required), [
      "title",
      "prompt",
    ]);
    for (const effect of lifecycle) await effect()();
  },
);

nativeTest(
  "proposal payloads are bounded and only enqueue visible optional metadata",
  async () => {
    const f = await fixture();
    for (const bad of [
      {},
      { tasks: [] },
      { tasks: [f.input.tasks[0], f.input.tasks[0]] },
      { tasks: Array(4).fill(f.input.tasks[0]) },
      { nextPrompt: "two\nlines" },
      { tasks: [{ title: "x", prompt: "a".repeat(8001) }] },
      { ...f.input, execute: true },
    ])
      assert.throws(() => f.box.inputSchema.parse(bad));
    const result = await f.propose();
    assert.equal(result.humanApprovalRequired, true);
    assert.equal(f.offer().tasks.length, 2);
    assert.equal(
      f.effects.filter((call) =>
        ["prepare", "child", "dispatch", "human-prompt"].includes(call.kind),
      ).length,
      0,
    );
    assert(f.events.every((row) => row.ignorable));
    const again = await f.propose();
    assert.equal(again.id, result.id);
    assert.equal(f.events.length, 1);
  },
);

nativeTest(
  "prompt preferences persist outside deployment configuration and ignore repeated writes",
  async () => {
    const f = await fixture();
    assert.equal((await f.service.preferences()).revision, 0);
    const off = await f.service.preferences({ enabled: false });
    assert.equal(off.promptSuggestions, false);
    assert.equal(off.revision, 1);
    assert.equal((await f.service.preferences({ enabled: false })).revision, 1);
    const restored = f.restart();
    assert.equal((await restored.preferences()).promptSuggestions, false);
    assert.equal((await restored.preferences({ enabled: true })).revision, 2);
    assert.equal(f.effects.length, 0);
    assert.equal(f.events.length, 0);
  },
);

nativeTest(
  "cold viewing and dismissal do not activate an Agent, and dismissed items cannot start",
  async () => {
    const f = await fixture();
    await f.propose();
    const current = f.offer();
    await f.service.view({ sessionId: f.root.id });
    await f.service.dismiss({
      sessionId: f.root.id,
      offerId: current.id,
      taskId: current.tasks[0].id,
    });
    const after = await f.service.view({ sessionId: f.root.id });
    assert.equal(after.offer.tasks[0].status, "dismissed");
    assert.equal(after.offer.tasks[1].status, "pending");
    assert.equal(after.offer.promptDismissed, true);
    assert(!f.effects.some((call) => call.kind === "resolve"));
    await f.accept("isolated", [current.tasks[0].id]);
    assert(
      !f.effects.some(
        (call) => call.kind === "prepare" || call.kind === "dispatch",
      ),
    );
    assert.equal(
      f.events.length,
      1,
      "Dismissing changes a preference, not the conversation log",
    );
  },
);

nativeTest(
  "Start all reserves durable identities, creates distinct native workspaces and dispatches each task once",
  async () => {
    const f = await fixture();
    await f.propose();
    const [first, repeated] = await Promise.all([f.accept(), f.accept()]);
    assert.equal(first.results.length, 2);
    assert(first.results.every((row) => row.status === "started"));
    assert(repeated.results.every((row) => row.status === "started"));
    const preparations = f.effects.filter((call) => call.kind === "prepare");
    const children = f.effects.filter((call) => call.kind === "child");
    assert.equal(preparations.length, 2);
    assert.equal(children.length, 2);
    assert.equal(
      f.effects.filter((call) => call.kind === "preflight").length,
      1,
      "One confirmation must pin one shared baseline for the batch",
    );
    assert.notEqual(children[0].request.cwd, children[1].request.cwd);
    assert(
      preparations.every(
        (call) => call.options.permissionPreset === "workspace-write",
      ),
    );
    assert(
      children.every(
        (call) =>
          call.request.context === "fresh" &&
          !call.request.prompt &&
          call.request.sessionId === f.root.id,
      ),
    );
    assert.equal(
      f.effects.filter((call) => call.kind === "dispatch").length,
      2,
    );
    assert.equal(
      f.root.status,
      "running",
      "Starting follow-ups must not stop or submit into the original task",
    );
    assert(!f.effects.some((call) => call.kind === "human-prompt"));
    for (const task of f.offer().tasks)
      assert(task.preparationSessionIds.length && task.childId);
  },
);

nativeTest(
  "Start all reports already dispatched work when a later source change prevents the remaining tasks",
  async () => {
    const f = await fixture();
    await f.propose();
    f.ctx.workspaceRegistry.archiveSession = async () =>
      f.event(f.root, "user/message", { source: { kind: "user" } });
    const result = await f.accept();
    assert.equal(result.results[0].status, "started");
    assert.match(result.results[1].error, /已变化/);
    assert.equal(
      f.effects.filter((call) => call.kind === "dispatch").length,
      1,
    );
  },
);

nativeTest(
  "Here queues one explicit human request and never replaces a draft or creates a child",
  async () => {
    const f = await fixture();
    await f.propose();
    const current = f.offer(),
      request = {
        sessionId: f.root.id,
        offerId: current.id,
        taskIds: [current.tasks[0].id],
        mode: "here",
      };
    const result = await f.service.accept(request);
    assert.equal(result.results[0].status, "here");
    const prompt = f.effects.find(
      (call) => call.kind === "human-prompt",
    ).request;
    assert.equal(prompt.mode, "queue");
    assert.equal(prompt.requestId, current.tasks[0].id);
    assert.equal(prompt.content[0].text, current.tasks[0].prompt);
    await assert.rejects(f.service.accept(request), /已变化/);
    assert.equal(
      f.effects.filter((call) => call.kind === "human-prompt").length,
      1,
    );
    assert(
      !f.effects.some(
        (call) => call.kind === "prepare" || call.kind === "child",
      ),
    );
  },
);

nativeTest(
  "preparation failure or a restored unfinished admission cannot silently retry effects",
  async () => {
    const f = await fixture();
    await f.propose();
    f.ctx.nestedSessions.start = async () => {
      throw new Error("native creation failed");
    };
    const selected = [f.offer().tasks[0].id];
    const result = await f.accept("isolated", selected);
    assert.match(result.results[0].error, /native creation failed/);
    assert.equal(f.offer().tasks[0].status, "uncertain");
    const before = f.effects.filter((call) => call.kind === "prepare").length;
    f.restart();
    await f.accept("isolated", selected);
    assert.equal(
      f.effects.filter((call) => call.kind === "prepare").length,
      before,
    );
    const g = await fixture();
    await g.propose();
    await g.service.change(g.root, g.offer().id, g.offer().tasks[0].id, {
      status: "admitting",
      preparationSessionIds: ["session-reserved"],
    });
    g.restart();
    await g.accept("isolated", [g.offer().tasks[0].id]);
    assert(
      !g.effects.some(
        (call) => call.kind === "prepare" || call.kind === "dispatch",
      ),
    );
  },
);

nativeTest(
  "new user input, stop, workspace or permission changes invalidate proposals and cancel unstarted work",
  async () => {
    for (const [type, data] of [
      ["user/message", { source: { kind: "user" } }],
      ["permission/preset", { preset: "read-only" }],
      ["working-directory/change", { cwd: "/elsewhere" }],
      ["turn/end", { reason: { kind: "aborted", reason: { kind: "user" } } }],
    ]) {
      const f = await fixture();
      await f.propose();
      const current = f.offer();
      f.event(f.root, type, data);
      await assert.rejects(
        f.service.accept({
          sessionId: f.root.id,
          offerId: current.id,
          taskIds: [current.tasks[0].id],
          mode: "isolated",
        }),
        /已变化/,
      );
      assert(!f.effects.some((call) => call.kind === "prepare"));
    }
    const f = await fixture();
    await f.propose();
    f.box.createRepositoryWorkspaces = async (_ctx, _plan, signal) => {
      f.event(f.root, "user/message", { source: { kind: "user" } });
      signal.throwIfAborted();
    };
    const result = await f.accept("isolated", [f.offer().tasks[0].id]);
    assert.match(result.results[0].error, /上下文或权限已改变/);
    assert(
      !f.effects.some(
        (call) => call.kind === "child" || call.kind === "dispatch",
      ),
    );
  },
);

nativeTest(
  "source changes cancel a confirmed brief while linked dispatch is waiting",
  async () => {
    for (const [type, data] of [
      ["user/message", { source: { kind: "user" } }],
      ["permission/preset", { preset: "read-only" }],
    ]) {
      const f = await fixture();
      await f.propose();
      let release, entered;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const waiting = new Promise((resolve) => {
        entered = resolve;
      });
      f.ctx.nestedSessions.sendWithSignal = async (request, signal) => {
        entered();
        await gate;
        signal.throwIfAborted();
        f.effects.push({ kind: "dispatch", request });
      };
      const accepted = f.accept("isolated", [f.offer().tasks[0].id]);
      await waiting;
      f.event(f.root, type, data);
      release();
      await accepted;
      assert(!f.effects.some((call) => call.kind === "dispatch"));
    }
  },
);

nativeTest(
  "disabled prompts, forked tickets, workers and read-only presets do not gain execution authority",
  async () => {
    const f = await fixture();
    f.config.promptSuggestions.get = () => false;
    const promptOnly = await f.service.propose(
      f.root,
      { nextPrompt: "One more thing" },
      AbortSignal.timeout(1000),
    );
    assert.equal(promptOnly.offered, false);
    assert.equal(f.events.length, 0);
    await f.propose();
    assert(!Object.hasOwn(f.offer(), "nextPrompt"));
    f.ctx.permissionPresets.current = () => "read-only";
    const current = f.offer(),
      result = await f.accept("isolated", [current.tasks[0].id]);
    assert.match(result.results[0].error, /只读/);
    assert.equal(f.offer().tasks[0].status, "pending");
    assert(!f.effects.some((call) => call.kind === "prepare"));
    f.states.set("session-fork", f.states.get(f.root.id));
    assert.equal(
      (await f.service.view({ sessionId: "session-fork" })).offer,
      null,
    );
    f.ctx.nestedSessions.list = async () => ({
      links: [{ sessionId: f.root.id, parentId: "session-parent" }],
    });
    await assert.rejects(f.propose(), /主会话/);
    f.ctx.invocation = { peer: { principal: { kind: "agent" } } };
    for (const method of ["view", "dismiss", "accept", "preferences"])
      await assert.rejects(f.service[method]({}), /Only the local owner/);
  },
);

nativeTest(
  "environment follow-ups isolate every repository and replace inherited source checkout metadata",
  async () => {
    const f = await fixture();
    await f.propose();
    f.ctx.localEnvironments.selectionFor = async () => ({
      id: "env",
      name: "Environment",
      requiredVariables: ["TOKEN"],
      repositories: [
        {
          key: "web",
          cwd: "/source-web",
          sourceRoot: "/source-web",
          worktree: true,
        },
        {
          key: "api",
          cwd: "/source-api",
          sourceRoot: "/source-api",
          worktree: true,
        },
      ],
    });
    const result = await f.accept("isolated", [f.offer().tasks[0].id]);
    assert.equal(result.results[0].status, "started");
    const selected = f.effects.find(
      (call) => call.kind === "environment",
    ).selection;
    assert.equal(selected.repositories.length, 2);
    assert(
      selected.repositories.every(
        (repo) =>
          repo.cwd.startsWith("/isolated/") && !Object.hasOwn(repo, "commit"),
      ),
    );
    assert.equal(
      f.effects.find((call) => call.kind === "preflight").inputs[1].path,
      "/source-api",
    );
  },
);
