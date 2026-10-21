import { z } from "zod";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";
import { openNestedStore } from "./state-store.js";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { randomUUID } from "node:crypto";
import {
  currentSessionModel,
  sessionModels,
  resolveSessionModel,
  installSessionModel,
} from "./model-routing.js";

export const name = "nested-sessions";
export const inject = [
  "sessionController",
  "storage",
  "agents",
  "tools",
  "remoteAccess",
  "typert",
  "sessions",
  "workspaceRegistry",
  "llm",
  "agentDefaultModel",
  "permissionPresets",
  "commands",
  "systemPrompt",
];
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+$/);
const text = z.string().trim().min(1).max(16000);
const schemas = {
  list: z
    .strictObject({ sessionId: id.optional(), all: z.boolean().optional() })
    .default({}),
  start: z.strictObject({
    sessionId: id,
    title: z.string().trim().min(1).max(160),
    prompt: text.optional(),
    context: z.enum(["fresh", "fork"]),
    agentPreset: id.optional(),
    cwd: z.string().min(1).max(4000).optional(),
    wakeParent: z.boolean().optional(),
    provider: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(300).optional(),
    reasoningEffort: z.string().min(1).max(50).optional(),
    reason: z.string().max(500).optional(),
  }),
  models: z.strictObject({
    sessionId: id,
    provider: z.string().min(1).max(200).optional(),
  }),
  policy: z.strictObject({
    sessionId: id,
    enabled: z.boolean(),
    requested: z.boolean().optional(),
  }),
  submit: z.strictObject({
    sessionId: id,
    message: text,
    collaborate: z.boolean().optional(),
  }),
  stopAll: z.strictObject({ sessionId: id }),
  detach: z.strictObject({ sessionId: id }),
  send: z.strictObject({ sessionId: id, targetSessionId: id, message: text }),
  read: z.strictObject({
    sessionId: id,
    limit: z.number().int().min(1).max(40).optional(),
  }),
  stop: z.strictObject({ sessionId: id }),
};
const initializers = [];
const messageText = (data) => {
  const message = data?.message ?? data;
  return Array.isArray(message?.content)
    ? message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
    : "";
};
const limited = (value, size = 8000) =>
  value.length > size ? value.slice(0, size) + "\n[truncated]" : value;
function outcomeOf(reason) {
  if (!reason) return undefined;
  return {
    kind: reason.kind,
    ...(reason.kind === "error"
      ? {
          code: reason.error?.code ?? "UNKNOWN",
          message: limited(
            String(reason.error?.message ?? "The turn failed"),
            1000,
          ),
        }
      : {}),
    ...(reason.kind === "aborted"
      ? { cause: reason.reason?.kind ?? "unknown" }
      : {}),
  };
}
function parse(method, request) {
  const result = schemas[method].safeParse(request);
  if (!result.success)
    throw new RemoteError(
      "gateway/bad-request",
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
      {},
    );
  return result.data;
}
function familyRoot(state, sessionId) {
  const visited = new Set();
  while (Object.hasOwn(state.links, sessionId)) {
    if (visited.has(sessionId))
      throw new Error("Nested session relationship contains a cycle");
    visited.add(sessionId);
    sessionId = state.links[sessionId].parentId;
  }
  return sessionId;
}

export class NestedSessions extends TypertRemoteService {
  static inject = inject;
  constructor(ctx, domain) {
    super(ctx, "nestedSessions", { namespace: "nestedSessions" });
    for (const initialize of initializers) initialize.call(this);
    this.domain = domain;
    this.tail = Promise.resolve();
    this.disposed = false;
    this.modelDisposers = new Map();
    this.stopVersions = new Map();
    this.liveStops = new Set();
    this.turnSignals = new Map();
  }
  markStopped(sessionId) {
    this.stopVersions.set(
      sessionId,
      (this.stopVersions.get(sessionId) ?? 0) + 1,
    );
    this.liveStops.add(sessionId);
  }
  isStopped(sessionId, state = this.domain.global.get()) {
    return state.stopped[sessionId] === true || this.liveStops.has(sessionId);
  }
  canReport(link, state = this.domain.global.get()) {
    const archived = this.ctx.workspaceRegistry.archivedSessionIds;
    return (
      !this.isStopped(link.sessionId, state) &&
      !this.isStopped(link.parentId, state) &&
      !archived.includes(link.sessionId) &&
      !archived.includes(link.parentId)
    );
  }
  trackTurn(agent, signal) {
    const previous = this.turnSignals.get(agent.id);
    if (previous?.signal === signal) return;
    previous?.dispose();
    const aborted = () => {
      if (signal.reason?.kind !== "user") return;
      this.markStopped(agent.id);
      void this.serialize(async () => {
        const state = this.domain.global.get();
        if (!state.stopped[agent.id])
          await this.domain.global.set({
            ...state,
            stopped: { ...state.stopped, [agent.id]: true },
          });
      }).catch((error) =>
        this.ctx.logger.warn(`nested-sessions stop: ${String(error)}`),
      );
    };
    this.turnSignals.set(agent.id, {
      signal,
      dispose: () => signal.removeEventListener("abort", aborted),
    });
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  }
  serialize(action) {
    const pending = this.tail.then(action);
    this.tail = pending.catch(() => {});
    return pending;
  }
  assertAccess(sessionId) {
    if (!this.ctx.remoteAccess.allows({ kind: "session", id: sessionId }))
      throw new RemoteError(
        "gateway/forbidden",
        "Session is not accessible",
        {},
      );
  }
  assertFamily(source, target) {
    const state = this.domain.global.get();
    if (familyRoot(state, source) !== familyRoot(state, target))
      throw new RemoteError(
        "gateway/forbidden",
        "The target is outside this linked session family",
        {},
      );
  }
  automatic(sessionId) {
    const state = this.domain.global.get();
    return state.auto?.[familyRoot(state, sessionId)] !== false;
  }
  explicitlyRequested(sessionId) {
    const state = this.domain.global.get();
    return state.requested?.[familyRoot(state, sessionId)] === true;
  }
  routeAgent(agent, selection) {
    if (this.modelDisposers.has(agent)) return;
    this.modelDisposers.set(agent, installSessionModel(agent, selection));
  }
  status(sessionId, state = this.domain.global.get()) {
    if (this.isStopped(sessionId, state)) return "stopped";
    const agent = this.ctx.agents.get(sessionId),
      link = state.links[sessionId];
    if (agent?.status === "running") return "running";
    if (
      agent &&
      (agent.inbox?.nextTurn.length ?? 0) +
        (agent.inbox?.nextStep.length ?? 0) >
        0
    )
      return "queued";
    if (["queued", "running"].includes(link?.status)) return "paused";
    return link?.status ?? link?.lastOutcome ?? "idle";
  }
  async models(request) {
    const input = parse("models", request);
    this.assertAccess(input.sessionId);
    return sessionModels(
      this.ctx,
      await this.agent(input.sessionId),
      input.provider,
    );
  }
  async policy(request) {
    const input = parse("policy", request);
    this.assertAccess(input.sessionId);
    return this.serialize(async () => {
      const state = this.domain.global.get(),
        root = familyRoot(state, input.sessionId);
      this.assertAccess(root);
      await this.domain.global.set({
        ...state,
        auto: { ...state.auto, [root]: input.enabled },
        requested: {
          ...state.requested,
          [root]: input.enabled && (input.requested ?? true),
        },
      });
      return {
        enabled: input.enabled,
        requested: input.enabled && (input.requested ?? true),
      };
    });
  }
  async submit(request) {
    const input = parse("submit", request);
    this.assertAccess(input.sessionId);
    const sessionId = familyRoot(this.domain.global.get(), input.sessionId);
    this.assertAccess(sessionId);
    this.assertActive(sessionId);
    if (input.collaborate) await this.policy({ sessionId, enabled: true });
    await this.ctx.sessionController.prompt(
      {
        sessionId,
        requestId: randomUUID(),
        mode: "queue",
        content: [
          {
            type: "text",
            text: input.collaborate
              ? "请启用独立子会话协作完成以下任务：先分析分工，再自行决定子会话数量及模型，通过 start_session 分派，收集实际结果后统一汇总。\n\n" +
                input.message
              : input.message,
          },
        ],
      },
      AbortSignal.timeout(30000),
    );
    return { submitted: true, sessionId };
  }
  async stopAll(request) {
    const input = parse("stopAll", request);
    this.assertAccess(input.sessionId);
    const state = this.domain.global.get(),
      root = familyRoot(state, input.sessionId);
    this.assertAccess(root);
    const children = Object.values(state.links).filter(
      (link) =>
        familyRoot(state, link.sessionId) === root &&
        ["idle", "queued", "running", "paused", "blocked"].includes(
          this.status(link.sessionId, state),
        ),
    );
    for (const link of children) this.assertAccess(link.sessionId);
    await this.policy({ sessionId: root, enabled: false });
    for (const link of children) await this.stop({ sessionId: link.sessionId });
    return { stopped: children.length };
  }
  async wait(caller, ids, signal, timeoutMs = 30000) {
    const targets = z.array(id).min(1).max(100).parse(ids);
    for (const target of targets) {
      this.assertAccess(target);
      this.assertFamily(caller, target);
      if (target === caller) throw new Error("不能等待当前会话自身");
    }
    const work = Promise.all(
      targets.map(
        (target) =>
          this.ctx.agents.get(target)?.whenIdle() ?? Promise.resolve(),
      ),
    );
    let timer, abort;
    try {
      await Promise.race([
        work,
        new Promise((resolve) => {
          timer = setTimeout(
            resolve,
            Math.min(60000, Math.max(1000, timeoutMs)),
          );
        }),
        new Promise((_, reject) => {
          abort = () => reject(signal.reason);
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
      ]);
      await this.tail;
      return {
        sessions: await Promise.all(
          targets.map((sessionId) => this.read({ sessionId, limit: 8 })),
        ),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  assertActive(sessionId) {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId))
      throw new RemoteError(
        "session/agent-busy",
        "Archived sessions cannot start or receive agent work; unarchive the session first",
        { reason: "archived" },
      );
  }
  assertMessaging(sessionId, role = "target") {
    this.assertActive(sessionId);
    if (this.isStopped(sessionId))
      throw new RemoteError(
        "session/agent-busy",
        `The user stopped the ${role}; open it and send a user message before sending agent messages`,
        { reason: "user-stopped" },
      );
  }
  async agent(sessionId) {
    this.assertActive(sessionId);
    const found = await this.ctx.sessionController.resolveAgent(sessionId);
    if (found.error) throw found.error;
    return found.agent;
  }
  async list(request) {
    const input = parse("list", request);
    if (input.sessionId) this.assertAccess(input.sessionId);
    const state = this.domain.global.get();
    const root =
      input.sessionId && !input.all
        ? familyRoot(state, input.sessionId)
        : undefined;
    return {
      automatic: input.sessionId ? this.automatic(input.sessionId) : true,
      requested: input.sessionId
        ? this.explicitlyRequested(input.sessionId)
        : false,
      links: Object.values(state.links)
        .filter(
          (link) =>
            (!root || familyRoot(state, link.sessionId) === root) &&
            this.ctx.remoteAccess.allows({
              kind: "session",
              id: link.sessionId,
            }) &&
            this.ctx.remoteAccess.allows({
              kind: "session",
              id: link.parentId,
            }),
        )
        .map((link) => ({
          ...link,
          ...(this.ctx.agents.get(link.sessionId)
            ? {
                selection: currentSessionModel(
                  this.ctx,
                  this.ctx.agents.get(link.sessionId),
                ),
              }
            : {}),
          status: this.status(link.sessionId, state),
          stoppedByUser: this.isStopped(link.sessionId, state),
        })),
    };
  }
  async start(request) {
    const input = parse("start", request);
    this.assertAccess(input.sessionId);
    if (input.context === "fork" && (input.cwd || input.agentPreset))
      throw new RemoteError(
        "gateway/bad-request",
        "A fork retains its source workspace and agent preset",
        {},
      );
    return this.serialize(async () => {
      this.assertActive(input.sessionId);
      const root = familyRoot(this.domain.global.get(), input.sessionId);
      if (root !== input.sessionId)
        throw new Error(
          `子会话不再创建下一层；请用 send_session_message 向主会话 ${root} 请求新的同级分工`,
        );
      const parentAgent = await this.agent(input.sessionId);
      const selection = await resolveSessionModel(this.ctx, parentAgent, input);
      const permissions = this.ctx.permissionPresets.current(
        parentAgent.session,
      );
      if (permissions === "custom")
        throw new Error(
          "当前使用自定义权限，无法安全继承到子会话；请先选择一个原生权限预设",
        );
      const parent = await this.ctx.sessionController.inspect(input.sessionId);
      const inheritedPreset =
        parent.events.findLast(
          (event) => event.type === "agent-preset/selected",
        )?.data.agentPreset ?? parent.meta.agentPreset;
      const workspace = this.ctx.workspaceRegistry
        .list()
        .find((row) => row.sessionIds.includes(input.sessionId));
      const created =
        input.context === "fork"
          ? await this.ctx.sessionController.fork({
              sessionId: input.sessionId,
            })
          : await this.ctx.sessionController.create({
              ...(input.cwd
                ? { cwd: input.cwd }
                : workspace
                  ? { workspaceId: workspace.id }
                  : { cwd: parent.meta.cwd }),
              agentPreset: input.agentPreset ?? inheritedPreset,
            });
      await this.ctx.sessionController.rename({
        sessionId: created.sessionId,
        title: input.title,
      });
      const child = await this.agent(created.sessionId);
      this.ctx.permissionPresets.set(child.session, permissions);
      child.session.append("model/selection", selection);
      this.routeAgent(child, selection);
      await this.ctx.sessions.flush(child.session);
      const state = this.domain.global.get();
      const link = {
        sessionId: created.sessionId,
        parentId: input.sessionId,
        title: input.title,
        kind: input.context,
        wakeParent: input.wakeParent ?? true,
        selection,
        status: input.prompt ? "queued" : "idle",
        ...(input.reason ? { reason: input.reason } : {}),
      };
      await this.domain.global.set({
        ...state,
        links: { ...state.links, [created.sessionId]: link },
      });
      if (input.prompt) {
        child.followup(
          createUserMessage({
            content: [
              {
                type: "text",
                text: `Task from linked parent session ${input.sessionId}:\n${input.prompt}`,
              },
            ],
            source: {
              kind: "agent-message",
              form: "relay",
              senderSessionId: input.sessionId,
            },
          }),
        );
        await this.ctx.sessions.flush(child.session);
      }
      return {
        sessionId: created.sessionId,
        parentId: input.sessionId,
        selection,
      };
    });
  }
  async detach(request) {
    const input = parse("detach", request);
    this.assertAccess(input.sessionId);
    return this.serialize(async () => {
      const state = this.domain.global.get();
      const link = state.links[input.sessionId];
      if (link) this.assertAccess(link.parentId);
      const { [input.sessionId]: removed, ...links } = state.links;
      await this.domain.global.set({ ...state, links });
      return { detached: !!removed };
    });
  }
  async send(request) {
    const input = parse("send", request);
    this.assertAccess(input.sessionId);
    this.assertAccess(input.targetSessionId);
    if (input.sessionId === input.targetSessionId)
      throw new RemoteError(
        "gateway/bad-request",
        "A session cannot message itself",
        {},
      );
    return this.serialize(async () => {
      this.assertFamily(input.sessionId, input.targetSessionId);
      this.assertMessaging(input.targetSessionId);
      this.assertMessaging(input.sessionId, "sender");
      const target = await this.agent(input.targetSessionId);
      this.assertMessaging(input.targetSessionId);
      this.assertMessaging(input.sessionId, "sender");
      target.followup(
        createUserMessage({
          content: [
            {
              type: "text",
              text: `Message from linked session ${input.sessionId}:\n${input.message}`,
            },
          ],
          source: {
            kind: "agent-message",
            form: "relay",
            senderSessionId: input.sessionId,
          },
        }),
      );
      await this.ctx.sessions.flush(target.session);
      return { sent: true };
    });
  }
  async read(request) {
    const input = parse("read", request);
    this.assertAccess(input.sessionId);
    const observation = await this.ctx.sessionController.inspect(
      input.sessionId,
    );
    const messages = observation.events
      .filter(
        (event) =>
          event.type === "assistant/message" ||
          (event.type === "user/message" &&
            ["user", "agent-message"].includes(event.data.source?.kind)),
      )
      .slice(-(input.limit ?? 12))
      .map((event) => ({
        role: event.type === "user/message" ? "user" : "assistant",
        text: limited(messageText(event.data), 2000),
      }));
    const outcome = outcomeOf(
      observation.events.findLast((event) => event.type === "turn/end")?.data
        .reason,
    );
    const state = this.domain.global.get(),
      link = state.links[input.sessionId],
      stopped = this.isStopped(input.sessionId, state);
    const latestResult = limited(
        messageText(
          observation.events.findLast(
            (event) => event.type === "assistant/message",
          )?.data,
        ),
      ),
      status = this.status(input.sessionId, state);
    return {
      sessionId: input.sessionId,
      content: limited(
        messages
          .map((message) => `${message.role}: ${message.text}`)
          .join("\n\n"),
        16000,
      ),
      latestResult,
      status,
      running: ["queued", "running"].includes(status),
      stoppedByUser: stopped,
      ...(outcome ? { outcome } : {}),
    };
  }
  async stop(request) {
    const input = parse("stop", request);
    this.assertAccess(input.sessionId);
    await this.serialize(async () => {
      const state = this.domain.global.get();
      await this.domain.global.set({
        ...state,
        stopped: { ...state.stopped, [input.sessionId]: true },
      });
      const agent = this.ctx.agents.get(input.sessionId);
      agent?.cancel({ kind: "user" }, { keepInbox: false });
      this.markStopped(input.sessionId);
      if (agent) await this.ctx.sessions.flush(agent.session);
    });
    return { stopped: true };
  }
  async observe(session, event) {
    if (this.disposed) return;
    if (["turn/start", "model/selection"].includes(event.type))
      await this.serialize(async () => {
        const state = this.domain.global.get(),
          link = state.links[session.id];
        if (!link) return;
        const { lastOutcome, ...withoutOutcome } = link;
        await this.domain.global.set({
          ...state,
          links: {
            ...state.links,
            [session.id]:
              event.type === "turn/start"
                ? { ...withoutOutcome, status: "running" }
                : { ...link, selection: event.data },
          },
        });
      });
    const human =
      (event.type === "user/message" && event.data.source?.kind === "user") ||
      (event.type === "agent/inbox/spliced" &&
        ["next-turn", "next-step"].includes(event.data.target) &&
        event.data.inserted.some((message) => message.source?.kind === "user"));
    const inbox = this.ctx.agents.get(session.id)?.inbox;
    const pendingHuman = [
      ...(inbox?.nextTurn ?? []),
      ...(inbox?.nextStep ?? []),
    ].some((message) => message.source?.kind === "user");
    const userStop =
      event.type === "turn/end" &&
      event.data.reason?.kind === "aborted" &&
      event.data.reason.reason?.kind === "user" &&
      !pendingHuman;
    const stopVersion = this.stopVersions.get(session.id);
    if (human || userStop)
      await this.serialize(async () => {
        const state = this.domain.global.get();
        const resumed =
          human && stopVersion === this.stopVersions.get(session.id);
        if ((resumed && this.isStopped(session.id, state)) || userStop) {
          const stopped = { ...state.stopped };
          if (resumed) {
            delete stopped[session.id];
            this.liveStops.delete(session.id);
          } else stopped[session.id] = true;
          await this.domain.global.set({ ...state, stopped });
        }
      });
    if (
      event.type !== "turn/end" ||
      !["completed", "error", "blocked"].includes(event.data.reason?.kind)
    )
      return;
    await this.serialize(async () => {
      let state = this.domain.global.get(),
        link = Object.hasOwn(state.links, session.id)
          ? state.links[session.id]
          : undefined;
      if (!link) return;
      const outcome = outcomeOf(event.data.reason);
      link = { ...link, status: outcome.kind, lastOutcome: outcome.kind };
      state = { ...state, links: { ...state.links, [session.id]: link } };
      await this.domain.global.set(state);
      if (
        !link?.wakeParent ||
        !this.canReport(link, state) ||
        (link.lastReportedSeq ?? -1) >= event.seq
      )
        return;
      const marker = `[Nested result ${session.id}:${event.seq}]`;
      const parentHistory = await this.ctx.sessionController.inspect(
        link.parentId,
      );
      if (
        !parentHistory.events.some((row) =>
          JSON.stringify(row.data).includes(marker),
        )
      ) {
        const childHistory = await this.ctx.sessionController.inspect(
          session.id,
        );
        if (!this.canReport(link)) return;
        const last = childHistory.events
          .filter(
            (row) =>
              row.seq <= event.seq &&
              row.type === "assistant/message" &&
              row.data.turn === event.data.turn,
          )
          .at(-1);
        const parent = await this.agent(link.parentId);
        if (!this.canReport(link)) return;
        const status =
          outcome.kind === "completed"
            ? "completed"
            : outcome.kind === "error"
              ? "failed"
              : "is blocked and needs attention";
        const summary =
          outcome.kind === "error"
            ? `${outcome.code}: ${outcome.message}`
            : outcome.kind === "blocked"
              ? "The child did not finish its task. Inspect the session before continuing."
              : limited(messageText(last?.data));
        parent.steer(
          createUserMessage({
            content: [
              {
                type: "text",
                text: `${marker}\nLinked session "${link.title}" ${status}.\n${summary}`,
              },
            ],
            source: {
              kind: "agent-message",
              form: "relay",
              senderSessionId: session.id,
            },
          }),
        );
        await this.ctx.sessions.flush(parent.session);
      }
      const current = this.domain.global.get();
      if (current.links[session.id]?.parentId === link.parentId)
        await this.domain.global.set({
          ...current,
          links: {
            ...current.links,
            [session.id]: {
              ...current.links[session.id],
              lastReportedSeq: event.seq,
            },
          },
        });
    });
  }
}
for (const method of Object.keys(schemas)) {
  const resources = {
    session: (request) =>
      method === "send"
        ? [request?.sessionId, request?.targetSessionId]
        : request?.sessionId,
  };
  Remote({ resources })(NestedSessions.prototype[method], {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer: (initialize) => initializers.push(initialize),
  });
}

function installTools(agent, service) {
  const target = {
    type: "string",
    required: true,
    description:
      "Session ID returned by start_session or list_linked_sessions.",
  };
  const definitions = [
    [
      "list_session_models",
      "List configured model choices and advertised capabilities for automatic task allocation. Omit provider to use the current session proxy/provider. Do not invent pricing or availability.",
      { provider: { type: "string" } },
      (args) =>
        service.models({
          sessionId: agent.id,
          ...(args.provider ? { provider: args.provider } : {}),
        }),
    ],
    [
      "start_session",
      "Only the root coordinator can delegate independent tasks to visible child conversations. A child must request additional workers from the root using send_session_message, never create grandchildren. Choose task count and models after analyzing the work and querying list_session_models. Collect child results before final synthesis.",
      {
        title: { type: "string", required: true },
        prompt: { type: "string", required: true },
        provider: { type: "string", required: true },
        model: { type: "string", required: true },
        reason: {
          type: "string",
          required: true,
          description:
            "One brief operational reason for this delegation and model choice.",
        },
        reasoning_effort: { type: "string" },
        cwd: {
          type: "string",
          description:
            "Use a previously created worktree directory for parallel code edits.",
        },
        context: { type: "string", enum: ["fresh", "fork"] },
        wake_parent: { type: "boolean" },
        agent_preset: {
          type: "string",
          enum: ["standard", "explore", "planner", "reviewer"],
          description:
            "Use standard for implementation; reviewer for independent read-only inspection. Fresh context only.",
        },
      },
      (args) => {
        if (!service.automatic(agent.id))
          throw new Error("当前任务已关闭自动分工；不要创建子会话");
        return service.start({
          sessionId: agent.id,
          title: args.title,
          prompt: args.prompt,
          provider: args.provider,
          model: args.model,
          reason: args.reason,
          context: args.context ?? "fresh",
          ...(args.agent_preset ? { agentPreset: args.agent_preset } : {}),
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.reasoning_effort
            ? { reasoningEffort: args.reasoning_effort }
            : {}),
          ...(args.wake_parent === undefined
            ? {}
            : { wakeParent: args.wake_parent }),
        });
      },
    ],
    [
      "list_linked_sessions",
      "List this conversation family and addressable nested sessions.",
      {},
      () => service.list({ sessionId: agent.id }),
    ],
    [
      "send_session_message",
      "Send a message to another linked family session. User-stopped sessions require the user to resume them first.",
      {
        target_session_id: target,
        message: { type: "string", required: true },
      },
      (args) => {
        service.assertFamily(agent.id, args.target_session_id);
        return service.send({
          sessionId: agent.id,
          targetSessionId: args.target_session_id,
          message: args.message,
        });
      },
    ],
    [
      "read_session",
      "Read bounded conversation text from this linked family only.",
      { session_id: target },
      (args) => {
        service.assertFamily(agent.id, args.session_id);
        return service.read({ sessionId: args.session_id });
      },
    ],
    [
      "stop_session",
      "Stop a linked session without deleting its history.",
      { session_id: target },
      (args) => {
        service.assertFamily(agent.id, args.session_id);
        return service.stop({ sessionId: args.session_id });
      },
    ],
    [
      "wait_for_sessions",
      "Wait for your assigned sessions and collect bounded results. If any remains running, continue useful work or wait again. Never report a final synthesis while required tasks are still running.",
      {
        session_ids: {
          type: "array",
          items: { type: "string" },
          required: true,
        },
        timeout_ms: { type: "number" },
      },
      (args, exec) =>
        service.wait(agent.id, args.session_ids, exec.signal, args.timeout_ms),
    ],
  ];
  const disposers = definitions.map(
    ([toolName, description, parameters, execute]) =>
      agent.ctx.tools.register(
        defineTool({
          name: toolName,
          description,
          parameters,
          output: {
            schema: { type: "object", additionalProperties: true },
            render: (_args, value) => [
              { type: "text", text: JSON.stringify(value) },
            ],
          },
          execute,
        }),
      ),
  );
  disposers.push(
    agent.ctx.on(
      "agent/pre-step",
      ({ signal }, next) => {
        service.trackTurn(agent, signal);
        return next();
      },
      { prepend: true },
    ),
  );
  disposers.push(() => {
    service.turnSignals.get(agent.id)?.dispose();
    service.turnSignals.delete(agent.id);
    service.stopVersions.delete(agent.id);
    service.liveStops.delete(agent.id);
  });
  disposers.push(
    agent.ctx.systemPrompt.context({
      name: "automatic-linked-sessions",
      order: 980,
      text: () => {
        if (!service.automatic(agent.id))
          return "Automatic linked-session delegation is OFF for this task family. Do not call start_session. Work directly; existing task history remains available. Only a user action or /collaborate on may re-enable it.";
        const state = service.domain.global.get(),
          link = state.links[agent.id];
        if (link)
          return `You are a worker for "${link.title}". Focus on this brief. The single coordinator is root session ${familyRoot(state, agent.id)}. Do not call start_session or create grandchildren, even if the task family has collaboration enabled. If more independent work is needed, send_session_message to that root with the proposed work and wait for its decision. Report your result to the assigning parent ${link.parentId}; completion is relayed automatically. You may read or message existing family sessions for coordination. A user /collaborate task from any worker is routed to the root.`;
        return `${service.explicitlyRequested(agent.id) ? "The user has explicitly enabled collaborative execution for this task. Analyze the work, then use start_session for separable work streams instead of doing every independent report in the parent. Choose worker count and models yourself; do not ask the user to configure them." : "Linked-session delegation is available on demand. First assess the request; keep simple or tightly coupled work local. When a request calls for separate independent investigations or work products, use visible linked sessions rather than requiring manual setup."} Choose the smallest sufficient number yourself. Query list_session_models before choosing provider/model, and give a short task/model rationale. Unknown prices or capabilities are not facts; using the current model is valid when alternatives have no demonstrated advantage. Use a complete fresh brief by default; fork only when completed history is needed. Give each child a concise deliverable with file evidence. Keep detailed subreports in their own conversations; the parent should produce a compact prioritized synthesis rather than copying every report again. Give parallel code writers separate existing worktrees and explicit cwd; never let them edit the same files concurrently. create_worktree changes the calling session's directory: record the delivery checkout and base commit first, return there before creating EACH worktree from that same base, then return before dispatching workers. Include only explicitly selected ignored configuration; do not implicitly copy credentials or uncommitted source changes. Review and integrate worker changes into the delivery checkout before final acceptance; branch-only work is not delivered work. Read or wait_for_sessions to collect all required results before final synthesis; if a child failed, report it and recover deliberately. Do not ask the user to open a manager or manually create sessions. You are the sole coordinator of this task family. Create all new workers as direct children and collect their actual results. Workers request more help from you rather than creating grandchildren. Child completion notifications resume you automatically.`;
      },
    }),
  );
  return disposers;
}

export async function apply(ctx) {
  const domain = await openNestedStore(ctx);
  const service = new NestedSessions(ctx, domain);
  const installed = new Map();
  const install = (agent) => {
    if (agent.session.header.origin === "subagent" || installed.has(agent))
      return;
    installed.set(agent, installTools(agent, service));
    const link = domain.global.get().links[agent.id];
    if (link?.selection) service.routeAgent(agent, link.selection);
  };
  for (const agent of ctx.agents.list()) install(agent);
  ctx.on("agent/created", ({ agent }) => install(agent));
  ctx.on("agent/disposed", ({ agent }) => {
    for (const dispose of installed.get(agent) ?? []) dispose();
    installed.delete(agent);
    service.modelDisposers.get(agent)?.();
    service.modelDisposers.delete(agent);
  });
  ctx.effect(() =>
    ctx.commands.register({
      name: "collaborate",
      description:
        "启用本任务协作：/collaborate 任务内容。数量和模型由 Agent 决定；on/off/auto 切换模式。",
      input: { hint: "[on|off|auto] [任务内容]" },
      async handler(invocation) {
        const raw = invocation.rawInput.trim(),
          match = /^(on|off|auto)(?:\s+([\s\S]*))?$/.exec(raw);
        const value = match?.[1] ?? "on",
          task = match ? (match[2] ?? "").trim() : raw;
        if (value === "off" && task)
          return {
            kind: "error",
            text: "暂停请用 /collaborate off；发起任务请用 /collaborate 任务内容",
          };
        await service.policy({
          sessionId: invocation.agent.id,
          enabled: value !== "off",
          requested: value === "on",
        });
        if (task)
          await service.submit({
            sessionId: invocation.agent.id,
            message: task,
            collaborate: value === "on",
          });
        return {
          kind: "success",
          text: task
            ? "任务已交给主会话，分工数量与模型由它选择。子会话只执行分配的任务，需要更多分工时向主会话请求。可在协作进度查看。"
            : value === "on"
              ? "主会话协作已开启（尚未提交新任务）。请回主会话描述任务，或输入 /collaborate 任务内容。Agent 自己决定分工数量和模型。"
              : value === "auto"
                ? "已恢复按需模式：简单任务直接处理，可独立推进的工作由 Agent 判断是否分工。"
                : "自动分工已暂停，不再新建子会话；已有任务可在分工进度中单独停止或全部停止。",
        };
      },
    }),
  );
  ctx.on("session/event", (session, event) => {
    service
      .observe(session, event)
      .catch((error) => ctx.logger.warn(`nested-sessions: ${String(error)}`));
  });
  ctx.effect(
    () => async () => {
      service.disposed = true;
      for (const disposers of installed.values())
        for (const dispose of disposers) dispose();
      installed.clear();
      for (const dispose of service.modelDisposers.values()) dispose();
      service.modelDisposers.clear();
      await service.tail;
      await domain.close();
    },
    "nested-sessions lifecycle",
  );
}
