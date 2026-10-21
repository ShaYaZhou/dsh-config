const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");

let z;
try {
  ({ z } = createRequire(
    path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@deepseek-ai/dsh/package.json",
    ),
  )("zod"));
} catch {}
const nativeTest = (title, body) =>
  test(
    title,
    { skip: !z && "Requires the installed Harness Zod runtime" },
    body,
  );
function fixture() {
  let next = 0,
    denied;
  const records = new Map(),
    agents = new Map(),
    deliveries = [];
  const domain = {
    state: { links: {}, stopped: {} },
    global: {
      get: () => domain.state,
      set: async (value) => {
        domain.state = JSON.parse(JSON.stringify(value));
      },
    },
  };
  const make = (sessionId, meta = {}) => {
    records.set(sessionId, {
      meta: {
        id: sessionId,
        cwd: "/fixture",
        agentPreset: "standard",
        ...meta,
      },
      events: [],
    });
    const hooks = new Map();
    const agent = {
      id: sessionId,
      status: "idle",
      options: { provider: "proxy", model: "current" },
      ctx: {
        on: (name, listener) => {
          hooks.set(name, listener);
          return () => hooks.delete(name);
        },
      },
      hooks,
      whenIdle: async () => {},
      session: {
        id: sessionId,
        snapshotEvents: () => records.get(sessionId).events,
        append: (type, data) =>
          records.get(sessionId).events.push({
            type,
            data,
            seq: records.get(sessionId).events.length,
          }),
      },
      cancel: (cause, options) => {
        agent.status = "idle";
        agent.cancelled = { cause, options };
        agent.queued = [];
        if (agent.inbox) {
          agent.inbox.nextTurn.length = 0;
          agent.inbox.nextStep.length = 0;
        }
      },
      steer: (message) =>
        deliveries.push({ sessionId, message, boundary: "step" }),
      followup: (message) =>
        deliveries.push({ sessionId, message, boundary: "turn" }),
    };
    agents.set(sessionId, agent);
    return agent;
  };
  make("root");
  make("unrelated");
  const ctx = {
    remoteAccess: { allows: (resource) => resource.id !== denied },
    agents: { get: (sessionId) => agents.get(sessionId) },
    sessions: { flush: async () => {} },
    agentDefaultModel: {
      currentSelection: () => ({ provider: "proxy", model: "current" }),
    },
    permissionPresets: {
      current: (session) => session.permission ?? "workspace-write",
      set: (session, name) => {
        session.permission = name;
      },
    },
    llm: {
      listModels: async () => [
        { id: "current" },
        { id: "small" },
        { id: "strong" },
      ],
      resolveModelInfo: async () => ({ contextWindow: 100000 }),
      resolveCallConfig: async (route) => route,
    },
    workspaceRegistry: {
      list: () => [{ id: "workspace", sessionIds: ["root"] }],
      archivedSessionIds: [],
    },
    sessionController: {
      inspect: async (sessionId) => {
        assert(records.has(sessionId));
        return records.get(sessionId);
      },
      resolveAgent: async (sessionId) => ({ agent: agents.get(sessionId) }),
      create: async (request) => {
        const sessionId = "fresh-" + ++next;
        make(sessionId, { agentPreset: request.agentPreset });
        return { sessionId };
      },
      fork: async ({ sessionId: parentId }) => {
        const sessionId = "fork-" + ++next;
        make(sessionId, { parentSession: parentId });
        records.get(sessionId).events = [...records.get(parentId).events];
        return { sessionId };
      },
      rename: async () => {},
      prompt: async (request) => deliveries.push(request),
      cancel: ({ sessionId }) => {
        agents.get(sessionId).status = "idle";
      },
    },
  };
  let source =
    fs.readFileSync(
      path.join(__dirname, "../plugins/nested-sessions/lib/model-routing.js"),
      "utf8",
    ) +
    "\n" +
    fs.readFileSync(
      path.join(__dirname, "../plugins/nested-sessions/lib/index.js"),
      "utf8",
    );
  source = source
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, "");
  source += "\nmodule.exports={NestedSessions,installTools};";
  const sandbox = {
    module: { exports: {} },
    z,
    Remote: () => () => {},
    RemoteError: class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
    TypertRemoteService: class {
      constructor(context) {
        this.ctx = context;
      }
    },
    defineDomain: (value) => value,
    createUserMessage: (value) => value,
    defineTool: (value) => value,
    Buffer,
    setTimeout,
    clearTimeout,
    AbortSignal,
    randomUUID: require("node:crypto").randomUUID,
  };
  vm.runInNewContext(source, sandbox);
  const service = new sandbox.module.exports.NestedSessions(ctx, domain);
  return {
    service,
    domain,
    records,
    agents,
    deliveries,
    ctx,
    installTools: sandbox.module.exports.installTools,
    deny: (value) => {
      denied = value;
    },
  };
}

nativeTest(
  "new turns invalidate completion records even while serialized reporting is held",
  async () => {
    const f = fixture();
    await f.service.observe(
      { id: "root" },
      { type: "turn/end", seq: 12, data: { reason: { kind: "completed" } } },
    );
    let release;
    f.service.tail = new Promise((resolve) => {
      release = resolve;
    });
    const started = f.service.observe(
      { id: "root" },
      { type: "turn/start", seq: 13, data: {} },
    );
    try {
      assert.equal((await f.service.list({ all: true })).completions.length, 0);
    } finally {
      release();
      await started;
    }
    const g = fixture();
    g.service.tail = new Promise((resolve) => {
      release = resolve;
    });
    const oldEnd = g.service.observe(
      { id: "root" },
      { type: "turn/end", seq: 12, data: { reason: { kind: "completed" } } },
    );
    const newStart = g.service.observe(
      { id: "root" },
      { type: "turn/start", seq: 13, data: {} },
    );
    release();
    await Promise.all([oldEnd, newStart]);
    assert.equal((await g.service.list({ all: true })).completions.length, 0);
  },
);

nativeTest(
  "completion records are ephemeral, owner-visible and respect stop/archive guards",
  async () => {
    const f = fixture();
    const complete = (id) =>
      f.service.observe(
        { id },
        { type: "turn/end", seq: 12, data: { reason: { kind: "completed" } } },
      );
    await complete("root");
    assert.equal(
      (await f.service.list({ all: true })).completions[0].notificationEligible,
      true,
    );
    assert.equal(
      (await f.service.list({ sessionId: "root" })).completions.length,
      0,
    );
    f.deny("root");
    assert.equal((await f.service.list({ all: true })).completions.length, 0);
    f.deny(undefined);
    await f.service.stop({ sessionId: "root" });
    assert.equal(
      (await f.service.list({ all: true })).completions[0].notificationEligible,
      false,
    );
    f.ctx.workspaceRegistry.archivedSessionIds.push("root");
    assert.equal(
      (await f.service.list({ all: true })).completions[0].notificationEligible,
      false,
    );
    await f.service.observe(
      { id: "root" },
      { type: "turn/start", data: {}, seq: 13 },
    );
    assert.equal((await f.service.list({ all: true })).completions.length, 0);
    assert.equal(f.deliveries.length, 0);
  },
);

nativeTest(
  "task recap reads bounded exact native projections without waking an agent",
  async () => {
    const f = fixture();
    let calls = 0;
    f.ctx.sessionController.projections = async ({ sessionId }, signal) => {
      assert.equal(sessionId, "root");
      assert(signal instanceof AbortSignal);
      calls++;
      return {
        kind: "sequenced",
        values: {
          todos: Array.from({ length: 45 }, (_, i) => ({
            content: "task " + i,
            status: "pending",
          })),
          turnOutline: Array.from({ length: 6 }, (_, i) => ({
            turn: i,
            response: i === 5 ? "" : "response " + i,
          })),
          otherPrivateProjection: "DO_NOT_RETURN",
        },
      };
    };
    const value = await f.service.progress({ sessionId: "root" });
    assert.equal(value.available, true);
    assert.equal(value.tasks.length, 40);
    assert.equal(value.taskCount, 45);
    assert.deepEqual(
      Array.from(value.recap, (item) => item.turn),
      [2, 3, 4],
    );
    assert(!JSON.stringify(value).includes("DO_NOT_RETURN"));
    assert.equal(f.deliveries.length, 0);
    f.deny("root");
    await assert.rejects(
      f.service.progress({ sessionId: "root" }),
      /denied|forbidden|access/i,
    );
    assert.equal(calls, 1);
    f.deny(undefined);
    f.ctx.sessionController.projections = async () => ({
      kind: "migration-required",
      values: { todos: [{ content: "stale" }] },
    });
    assert.equal(
      (await f.service.progress({ sessionId: "root" })).available,
      false,
    );
    f.ctx.sessionController.projections = async () => {
      f.deny("root");
      return { kind: "sequenced", values: {} };
    };
    await assert.rejects(
      f.service.progress({ sessionId: "root" }),
      /denied|forbidden|access/i,
    );
  },
);

nativeTest(
  "one coordinator owns delegation and child collaboration requests route to the root",
  async () => {
    const f = fixture();
    const child = await f.service.start({
      sessionId: "root",
      title: "Worker",
      context: "fresh",
    });
    const before = f.records.size;
    await assert.rejects(
      f.service.start({
        sessionId: child.sessionId,
        title: "Grandchild",
        context: "fresh",
      }),
      /send_session_message/,
    );
    assert.equal(f.records.size, before);
    const submitted = await f.service.submit({
      sessionId: child.sessionId,
      message: "需要另一份独立报告",
      collaborate: true,
    });
    assert.equal(submitted.sessionId, "root");
    assert.equal(f.deliveries.at(-1).sessionId, "root");
    assert(f.deliveries.at(-1).content[0].text.includes("需要另一份独立报告"));
    f.deny("root");
    await assert.rejects(
      f.service.submit({
        sessionId: child.sessionId,
        message: "denied",
        collaborate: true,
      }),
      /denied|forbidden|access/i,
    );
  },
);

nativeTest(
  "agent-chosen child models are session-local and inherit the parent permission",
  async () => {
    const f = fixture();
    f.agents.get("root").session.permission = "read-only";
    const child = await f.service.start({
      sessionId: "root",
      title: "Review",
      context: "fresh",
      provider: "proxy",
      model: "small",
      reason: "独立审查",
    });
    const agent = f.agents.get(child.sessionId);
    assert.equal(agent.session.permission, "read-only");
    assert.equal(child.selection.model, "small");
    assert.equal(f.ctx.agentDefaultModel.currentSelection().model, "current");
    const assemble = agent.hooks.get("system-prompt/assemble"),
      request = agent.hooks.get("agent/request");
    const prompt = await assemble({}, {}, async () => ({
      variables: { model: "current" },
    }));
    assert.equal(prompt.variables.model, "small");
    assert.equal(
      (await request({}, async () => ({ provider: "proxy", model: "current" })))
        .model,
      "small",
    );
    agent.session.append("model/selection", {
      provider: "proxy",
      model: "strong",
    });
    await assemble({}, {}, async () => ({ variables: {} }));
    assert.equal(
      (await request({}, async () => ({ provider: "proxy", model: "current" })))
        .model,
      "strong",
    );
    const count = f.records.size;
    await assert.rejects(
      f.service.start({
        sessionId: "root",
        title: "Bad",
        context: "fresh",
        model: "missing",
      }),
      /未在当前/,
    );
    assert.equal(f.records.size, count);
  },
);

nativeTest(
  "automatic delegation defaults on and a user pause prevents model-created children",
  async () => {
    const f = fixture(),
      agent = f.agents.get("root"),
      tools = new Map();
    agent.ctx.tools = {
      register: (definition) => {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    };
    agent.ctx.systemPrompt = { context: () => () => {} };
    f.installTools(agent, f.service);
    assert.equal(f.service.automatic("root"), true);
    assert.equal(f.service.explicitlyRequested("root"), false);
    await f.service.policy({ sessionId: "root", enabled: false });
    await assert.rejects(
      async () =>
        tools.get("start_session").execute({
          title: "No",
          prompt: "No",
          provider: "proxy",
          model: "small",
          reason: "No",
        }),
      /关闭自动分工/,
    );
    assert.equal(f.records.size, 2);
    await f.service.policy({ sessionId: "root", enabled: true });
    assert.equal(f.service.explicitlyRequested("root"), true);
    const child = await tools.get("start_session").execute({
      title: "Yes",
      prompt: "Independent work",
      provider: "proxy",
      model: "small",
      reason: "独立任务",
      agent_preset: "reviewer",
    });

    assert.equal(child.selection.model, "small");
    assert.equal(f.records.get(child.sessionId).meta.agentPreset, "reviewer");
    assert.equal(
      (await f.service.list({ sessionId: child.sessionId })).automatic,
      true,
    );
  },
);

nativeTest(
  "stop-all cancels unfinished children without relabeling completed history",
  async () => {
    const f = fixture();
    const finished = await f.service.start({
      sessionId: "root",
      title: "Finished",
      context: "fresh",
    });
    const pending = await f.service.start({
      sessionId: "root",
      title: "Pending",
      context: "fresh",
      prompt: "Work",
    });
    await f.service.observe(f.agents.get(finished.sessionId).session, {
      type: "turn/end",
      seq: 3,
      data: { turn: 1, reason: { kind: "completed" } },
    });
    const result = await f.service.stopAll({ sessionId: "root" });
    assert.equal(result.stopped, 1);
    assert.equal(f.service.status(finished.sessionId), "completed");
    assert.equal(f.service.status(pending.sessionId), "stopped");
    assert.equal(f.service.automatic("root"), false);
  },
);

nativeTest(
  "waiting collects actual terminal results and refuses self or unrelated targets",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "Waiting",
        context: "fresh",
      }),
      agent = f.agents.get(child.sessionId);
    let complete;
    agent.whenIdle = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    agent.status = "running";
    const waiting = f.service.wait(
      "root",
      [child.sessionId],
      AbortSignal.timeout(5000),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.records.get(child.sessionId).events.push({
      seq: 9,
      type: "assistant/message",
      data: { turn: 1, content: [{ type: "text", text: "Finished result" }] },
    });
    agent.status = "idle";
    await f.service.observe(agent.session, {
      seq: 10,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    });
    complete();
    const result = await waiting;
    assert.equal(result.sessions[0].running, false);
    assert.equal(result.sessions[0].latestResult, "Finished result");
    await assert.rejects(
      f.service.wait("root", ["root"], AbortSignal.timeout(5000)),
      /自身/,
    );
    await assert.rejects(
      f.service.wait("root", ["unrelated"], AbortSignal.timeout(5000)),
      /outside/,
    );
  },
);

nativeTest(
  "independent fresh/fork children can detach without deleting history",
  async () => {
    const f = fixture();
    f.records.get("root").events.push({
      seq: 0,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "kept" }] } },
    });
    const fresh = await f.service.start({
      sessionId: "root",
      title: "A",
      context: "fresh",
    });
    const fork = await f.service.start({
      sessionId: "root",
      title: "B",
      context: "fork",
    });
    assert.equal(fresh.parentId, "root");
    assert.equal(fork.parentId, "root");
    assert.equal((await f.service.list({ sessionId: "root" })).links.length, 2);
    f.records.get(fork.sessionId).events.push({
      seq: 1,
      type: "assistant/message",
      data: {
        message: { content: [{ type: "text", text: "fork history" }] },
      },
    });
    await f.service.detach({ sessionId: fork.sessionId });
    assert.equal((await f.service.list({ sessionId: "root" })).links.length, 1);
    assert(
      (await f.service.read({ sessionId: fork.sessionId })).content.includes(
        "fork history",
      ),
    );
  },
);

nativeTest(
  "fresh children inherit the latest selected preset after an old header was migrated",
  async () => {
    const f = fixture();
    f.records.get("root").meta.agentPreset = "retired-preset";
    f.records.get("root").events.push({
      type: "agent-preset/selected",
      seq: 0,
      data: { agentPreset: "standard" },
    });
    const child = await f.service.start({
      sessionId: "root",
      title: "Migrated child",
      context: "fresh",
    });
    assert.equal(f.records.get(child.sessionId).meta.agentPreset, "standard");
    const explicit = await f.service.start({
      sessionId: "root",
      title: "Explicit child",
      context: "fresh",
      agentPreset: "reviewer",
    });
    assert.equal(
      f.records.get(explicit.sessionId).meta.agentPreset,
      "reviewer",
    );
  },
);

nativeTest(
  "linked messages retain agent provenance and reject unrelated or user-stopped targets",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "A",
        context: "fresh",
      });
    await f.service.send({
      sessionId: "root",
      targetSessionId: child.sessionId,
      message: "Check API",
    });
    assert.equal(f.deliveries[0].message.source.kind, "agent-message");
    assert.equal(f.deliveries[0].message.source.senderSessionId, "root");
    assert.equal(f.deliveries[0].boundary, "turn");
    await assert.rejects(
      f.service.send({
        sessionId: "root",
        targetSessionId: "unrelated",
        message: "No",
      }),
      /outside/,
    );
    await f.service.stop({ sessionId: child.sessionId });
    assert.equal(
      f.agents.get(child.sessionId).cancelled.options.keepInbox,
      false,
    );
    await assert.rejects(
      f.service.send({
        sessionId: "root",
        targetSessionId: child.sessionId,
        message: "No restart",
      }),
      /user stopped/i,
    );
    await f.service.observe(
      { id: child.sessionId },
      { type: "user/message", data: { source: { kind: "user" } } },
    );
    await f.service.send({
      sessionId: "root",
      targetSessionId: child.sessionId,
      message: "User resumed",
    });
  },
);

nativeTest(
  "native human enqueue resumes before request preparation and a late abort cannot undo it",
  async () => {
    const f = fixture(),
      agent = f.agents.get("root");
    agent.inbox = { nextTurn: [], nextStep: [] };
    await f.service.stop({ sessionId: "root" });
    await f.service.observe(agent.session, {
      type: "agent/inbox/spliced",
      data: {
        target: "next-turn",
        inserted: [{ source: { kind: "agent-message" } }],
      },
    });
    assert.equal(f.domain.state.stopped.root, true);
    const human = {
      source: { kind: "user" },
      content: [{ type: "text", text: "Resume" }],
    };
    agent.inbox.nextTurn.push(human);
    await f.service.observe(agent.session, {
      type: "agent/inbox/spliced",
      data: { target: "next-turn", inserted: [human] },
    });
    assert.equal(f.domain.state.stopped.root, undefined);
    await f.service.observe(agent.session, {
      type: "turn/end",
      data: { reason: { kind: "aborted", reason: { kind: "user" } } },
    });
    assert.equal(f.domain.state.stopped.root, undefined);
    agent.inbox.nextTurn = [];
    await f.service.observe(agent.session, {
      type: "turn/end",
      data: { reason: { kind: "aborted", reason: { kind: "user" } } },
    });
    assert.equal(f.domain.state.stopped.root, true);
  },
);

nativeTest(
  "cancel wins over stale human enqueue while a later human action can resume",
  async () => {
    const f = fixture(),
      agent = f.agents.get("root");
    agent.inbox = { nextTurn: [], nextStep: [] };
    const human = { source: { kind: "user" } };
    const enqueue = {
      type: "agent/inbox/spliced",
      data: { target: "next-turn", inserted: [human] },
    };
    const stopping = f.service.stop({ sessionId: "root" });
    agent.inbox.nextTurn.push(human);
    const observed = f.service.observe(agent.session, enqueue);
    await Promise.all([stopping, observed]);
    assert.equal(f.service.isStopped("root"), true);
    assert.equal(agent.inbox.nextTurn.length, 0);
    const cancel = new AbortController();
    f.service.trackTurn(agent, cancel.signal);
    const staleResume = f.service.observe(agent.session, enqueue);
    cancel.abort({ kind: "user" });
    await staleResume;
    assert.equal(f.service.isStopped("root"), true);
    agent.inbox.nextTurn.push(human);
    await f.service.observe(agent.session, enqueue);
    assert.equal(f.service.isStopped("root"), false);
  },
);

nativeTest(
  "stopping clears queued work and archived sessions cannot be revived by sends or starts",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "A",
        context: "fresh",
      });
    const agent = f.agents.get(child.sessionId);
    agent.queued = ["already queued"];
    agent.status = "running";
    await f.service.stop({ sessionId: child.sessionId });
    assert.equal(agent.queued.length, 0);
    assert.equal(agent.status, "idle");
    await f.service.observe(
      { id: child.sessionId },
      { type: "user/message", data: { source: { kind: "user" } } },
    );
    f.ctx.workspaceRegistry.archivedSessionIds.push(child.sessionId);
    await assert.rejects(
      f.service.send({
        sessionId: "root",
        targetSessionId: child.sessionId,
        message: "No revival",
      }),
      /Archived/,
    );
    await assert.rejects(
      f.service.start({
        sessionId: child.sessionId,
        title: "No new child",
        context: "fresh",
      }),
      /Archived/,
    );
    assert((await f.service.read({ sessionId: child.sessionId })).sessionId);
  },
);

nativeTest(
  "strict requests and session access guards reject before creating or disclosing data",
  async () => {
    const f = fixture();
    await assert.rejects(
      f.service.start({
        sessionId: "root",
        title: "A",
        context: "fresh",
        extra: true,
      }),
      /Unrecognized|unrecognized/,
    );
    await assert.rejects(
      f.service.start({
        sessionId: "root",
        title: "A",
        context: "fork",
        cwd: "/elsewhere",
      }),
      /retains/,
    );
    await assert.rejects(
      f.service.read({ sessionId: "../escape" }),
      /Invalid|invalid/,
    );
    const child = await f.service.start({
      sessionId: "root",
      title: "A",
      context: "fresh",
    });
    f.deny(child.sessionId);
    assert.equal((await f.service.list({ sessionId: "root" })).links.length, 0);
    await assert.rejects(
      f.service.read({ sessionId: child.sessionId }),
      /not accessible/,
    );
    await assert.rejects(
      f.service.send({
        sessionId: "root",
        targetSessionId: child.sessionId,
        message: "No leak",
      }),
      /not accessible/,
    );
  },
);

nativeTest(
  "a native stop or archive during asynchronous resolution wins before delivery",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "Worker",
        context: "fresh",
      });
    const resolve = f.ctx.sessionController.resolveAgent;
    f.ctx.sessionController.resolveAgent = async (id) => {
      const found = await resolve(id);
      f.service.markStopped(id);
      return found;
    };
    await assert.rejects(
      f.service.send({
        sessionId: "root",
        targetSessionId: child.sessionId,
        message: "Too late",
      }),
      /user stopped/i,
    );
    assert.equal(f.deliveries.length, 0);
    for (const mode of ["stop", "archive"]) {
      const h = fixture(),
        receiver = await h.service.start({
          sessionId: "root",
          title: "Receiver",
          context: "fresh",
        });
      const resolveTarget = h.ctx.sessionController.resolveAgent;
      h.ctx.sessionController.resolveAgent = async (id) => {
        const found = await resolveTarget(id);
        if (mode === "stop") h.service.markStopped("root");
        else h.ctx.workspaceRegistry.archivedSessionIds.push("root");
        return found;
      };
      await assert.rejects(
        h.service.send({
          sessionId: "root",
          targetSessionId: receiver.sessionId,
          message: "Cancelled sender",
        }),
        /stopped|Archived/i,
      );
      assert.equal(h.deliveries.length, 0);
    }
    for (const mode of ["stop", "archive"]) {
      const g = fixture(),
        worker = await g.service.start({
          sessionId: "root",
          title: "Worker",
          context: "fresh",
        });
      const inspect = g.ctx.sessionController.inspect;
      g.ctx.sessionController.inspect = async (id) => {
        const value = await inspect(id);
        if (id === worker.sessionId) {
          if (mode === "stop") g.service.markStopped("root");
          else g.ctx.workspaceRegistry.archivedSessionIds.push("root");
        }
        return value;
      };
      await g.service.observe(
        { id: worker.sessionId },
        {
          type: "turn/end",
          seq: 2,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      );
      assert.equal(g.deliveries.length, 0);
    }
  },
);

nativeTest(
  "completion is bounded and deduplicated, and never revives a stopped parent",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "A",
        context: "fresh",
      });
    f.records.get(child.sessionId).events.push({
      seq: 1,
      type: "assistant/message",
      data: {
        message: { content: [{ type: "text", text: "x".repeat(20000) }] },
      },
    });
    const complete = {
      seq: 2,
      type: "turn/end",
      data: { reason: { kind: "completed" } },
    };
    await f.service.observe({ id: child.sessionId }, complete);
    await f.service.observe({ id: child.sessionId }, complete);
    assert.equal(f.deliveries.length, 1);
    assert(f.deliveries[0].message.content[0].text.length < 8500);
    assert.equal(f.deliveries[0].message.source.kind, "agent-message");
    await f.service.stop({ sessionId: "root" });
    await f.service.observe({ id: child.sessionId }, { ...complete, seq: 3 });
    assert.equal(f.deliveries.length, 1);
  },
);

nativeTest(
  "failed and blocked child turns report explicit bounded outcomes without tool arguments",
  async () => {
    const f = fixture(),
      child = await f.service.start({
        sessionId: "root",
        title: "Worker",
        context: "fresh",
      });
    f.records.get(child.sessionId).events.push({
      type: "tool/call",
      seq: 1,
      data: { arguments: { token: "secret-tool-argument" } },
    });
    const failure = {
      type: "turn/end",
      seq: 2,
      data: {
        turn: 1,
        reason: {
          kind: "error",
          error: {
            code: "FIXTURE_ERROR",
            message: "failure".repeat(1000),
            privateArguments: "secret-tool-argument",
          },
        },
      },
    };
    f.records.get(child.sessionId).events.push(failure);
    await f.service.observe({ id: child.sessionId }, failure);
    await f.service.observe({ id: child.sessionId }, failure);
    assert.equal(f.deliveries.length, 1);
    assert(f.deliveries[0].message.content[0].text.includes("failed"));
    assert(f.deliveries[0].message.content[0].text.length < 1400);
    assert(!JSON.stringify(f.deliveries).includes("secret-tool-argument"));
    const read = await f.service.read({ sessionId: child.sessionId });
    assert.equal(read.outcome.kind, "error");
    assert.equal(read.outcome.code, "FIXTURE_ERROR");
    assert(read.outcome.message.length < 1100);
    const blocked = {
      type: "turn/end",
      seq: 3,
      data: { turn: 2, reason: { kind: "blocked" } },
    };
    await f.service.observe({ id: child.sessionId }, blocked);
    assert(
      f.deliveries[1].message.content[0].text.includes(
        "blocked and needs attention",
      ),
    );
    assert.equal(
      (await f.service.list({ sessionId: "root" })).links[0].lastOutcome,
      "blocked",
    );
  },
);
