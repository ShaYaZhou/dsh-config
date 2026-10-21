import { z } from "zod";
import { randomUUID } from "node:crypto";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
  principalOf,
} from "@deepseek-ai/dsh-typert-protocol";
import {
  preflightRepositories,
  createRepositoryWorkspaces,
} from "@local/dsh-local-environments/workspace";
import {
  sessionId,
  proposalInput,
  stateSchema,
  changeSchema,
  records,
  initialState,
  scopeChanged,
  fold,
} from "./state.js";

export const name = "follow-ups";
export const inject = [
  "typert",
  "storage",
  "agents",
  "sessions",
  "sessionController",
  "sessionProjections",
  "nestedSessions",
  "workspaceRegistry",
  "workingDirectory",
  "permissionPresets",
  "localEnvironments",
  "worktrees",
  "subprocess",
  "tools",
  "systemPrompt",
];
const schemas = {
  preferences: z.strictObject({ enabled: z.boolean().optional() }).default({}),
  view: z.strictObject({ sessionId }),
  dismiss: z.strictObject({
    sessionId,
    offerId: z.uuid(),
    taskId: z.uuid().optional(),
    promptOnly: z.boolean().default(false),
  }),
  accept: z
    .strictObject({
      sessionId,
      offerId: z.uuid(),
      taskIds: z
        .array(z.uuid())
        .min(1)
        .max(3)
        .refine((ids) => new Set(ids).size === ids.length),
      mode: z.enum(["isolated", "here"]),
    })
    .refine(
      (value) => value.mode !== "here" || value.taskIds.length === 1,
      "Continue one task at a time in the current conversation",
    ),
};
const initializers = [];
const preferenceSchema = z.strictObject({
  offerId: z.uuid(),
  taskIds: z.array(z.uuid()).max(3),
  prompt: z.boolean(),
});
const preferenceSpec = defineDomain({
  name: "follow_up_preferences",
  version: 1,
  tables: { dismissed: domainTable(preferenceSchema) },
  global: {
    initial: { promptSuggestions: true, revision: 0 },
    schema: z.strictObject({
      promptSuggestions: z.boolean(),
      revision: z.number().int().min(0),
    }),
  },
});

export class FollowUps extends TypertRemoteService {
  constructor(ctx, preferences) {
    super(ctx, "followUps");
    for (const initialize of initializers) initialize.call(this);
    this.preferenceDomain = preferences;
    this.dismissed = preferences.table("dismissed");
    this.tails = new Map();
    this.active = new Map();
    this.lifetime = new AbortController();
    ctx.sessionProjections.register({
      key: "followUps",
      stateVersion: 1,
      stateSchema,
      init: initialState,
      apply: fold,
      wire: { viewSchema: stateSchema, view: (state) => state },
    });
  }
  promptEnabled() {
    return this.preferenceDomain.global.get().promptSuggestions === true;
  }
  async preferences(request) {
    const input = this.owner("preferences", request),
      signal = this.signal();
    return this.serialize("@preferences", signal, async () => {
      const current = this.preferenceDomain.global.get();
      if (
        input.enabled !== undefined &&
        input.enabled !== current.promptSuggestions
      )
        await this.preferenceDomain.global.set({
          promptSuggestions: input.enabled,
          revision: current.revision + 1,
        });
      return this.preferenceDomain.global.get();
    });
  }
  signal(signal = this.ctx.invocation?.signal) {
    return AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(120000),
      ...(signal ? [signal] : []),
    ]);
  }
  owner(method, request) {
    if (principalOf(this.ctx.invocation))
      throw new RemoteError(
        "gateway/forbidden",
        "Only the local owner may confirm follow-up tasks",
        {},
      );
    this.lifetime.signal.throwIfAborted();
    return schemas[method].parse(request);
  }
  serialize(id, signal, operation) {
    const pending = (this.tails.get(id) ?? Promise.resolve()).then(() => {
      signal.throwIfAborted();
      return operation();
    });
    const joined = pending.catch(() => {});
    this.tails.set(id, joined);
    void joined.then(() => {
      if (this.tails.get(id) === joined) this.tails.delete(id);
    });
    return pending;
  }
  assertAvailable(id) {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(id))
      throw new Error("请先取消归档，再确认后续任务");
  }
  ownState(session) {
    return stateSchema.parse(
      this.ctx.sessionProjections.stateOf(session, "followUps") ??
        initialState(),
    );
  }
  visibleOffer(offer) {
    if (!offer) return null;
    const hidden = this.dismissed.get(offer.owner);
    if (hidden?.offerId !== offer.id) return offer;
    return {
      ...offer,
      promptDismissed: offer.promptDismissed || hidden.prompt,
      tasks: offer.tasks.map((task) =>
        task.status === "pending" && hidden.taskIds.includes(task.id)
          ? { ...task, status: "dismissed" }
          : task,
      ),
    };
  }
  async readState(id, signal) {
    const projected = await this.ctx.sessionController.projections(
      { sessionId: id },
      signal,
    );
    signal.throwIfAborted();
    if (projected?.kind !== "sequenced")
      throw new Error("当前会话建议暂时不可读取");
    return stateSchema.parse(projected.values.followUps ?? initialState());
  }
  async assertRoot(agent, signal) {
    if (agent.session.header.origin === "subagent")
      throw new Error("子代理将后续建议报告给主会话，不直接提出新任务");
    const family = await this.ctx.nestedSessions.list({ sessionId: agent.id });
    signal.throwIfAborted();
    if (family.links.some((link) => link.sessionId === agent.id))
      throw new Error("由主会话汇总并提出后续建议，子会话不创建下一层任务");
    this.assertAvailable(agent.id);
  }
  currentOffer(agent, id, signal) {
    signal.throwIfAborted();
    this.assertAvailable(agent.id);
    const { offer, epoch } = this.ownState(agent.session);
    if (
      !offer ||
      offer.owner !== agent.id ||
      offer.id !== id ||
      offer.epoch !== epoch ||
      offer.cwd !== this.ctx.workingDirectory.get(agent.session)
    )
      throw new Error("建议所属任务或工作目录已变化，请使用当前任务的新建议");
    return this.visibleOffer(offer);
  }
  async record(session, type, data) {
    appendPluginRecord(session, type, data);
    await this.ctx.sessions.flush(session);
  }
  async propose(agent, request, toolSignal) {
    const input = proposalInput.parse(request),
      signal = this.signal(toolSignal);
    await this.assertRoot(agent, signal);
    const previous = this.ownState(agent.session);
    if (
      previous.offer?.owner === agent.id &&
      previous.offer.epoch === previous.epoch
    )
      return {
        offered: true,
        id: previous.offer.id,
        alreadyOffered: true,
        humanApprovalRequired: true,
      };
    return this.serialize(agent.id, signal, async () => {
      this.assertAvailable(agent.id);
      const state = this.ownState(agent.session);
      if (state.offer?.owner === agent.id && state.offer.epoch === state.epoch)
        return {
          offered: true,
          id: state.offer.id,
          alreadyOffered: true,
          humanApprovalRequired: true,
        };
      const pending = [
        ...(agent.inbox?.nextTurn ?? []),
        ...(agent.inbox?.nextStep ?? []),
      ];
      if (pending.some((message) => message.source?.kind === "user"))
        throw new Error("用户有尚未处理的新消息，请处理后再提出建议");
      const nextPrompt = this.promptEnabled() ? input.nextPrompt : undefined;
      if (!input.tasks.length && !nextPrompt)
        return { offered: false, promptSuggestionsDisabled: true };
      signal.throwIfAborted();
      const offer = {
        id: randomUUID(),
        owner: agent.id,
        epoch: state.epoch,
        cwd: this.ctx.workingDirectory.get(agent.session),
        tasks: input.tasks.map((task) => ({
          ...task,
          id: randomUUID(),
          status: "pending",
        })),
        ...(nextPrompt ? { nextPrompt } : {}),
        promptReady: false,
        promptDismissed: false,
      };
      await this.record(agent.session, records.offered, offer);
      return {
        offered: true,
        id: offer.id,
        taskCount: offer.tasks.length,
        humanApprovalRequired: true,
      };
    });
  }
  async view(request) {
    const input = this.owner("view", request),
      state = await this.readState(input.sessionId, this.signal());
    const preference = this.preferenceDomain.global.get();
    const flags = {
      promptSuggestionsEnabled: preference.promptSuggestions,
      preferenceRevision: preference.revision,
    };
    if (state.offer?.owner !== input.sessionId)
      return { offer: null, ...flags };
    return {
      offer: this.visibleOffer(state.offer),
      archived: this.ctx.workspaceRegistry.archivedSessionIds.includes(
        input.sessionId,
      ),
      activeTaskIds: this.active.get(input.sessionId)?.taskId
        ? [this.active.get(input.sessionId).taskId]
        : [],
      ...flags,
    };
  }
  async dismiss(request) {
    const input = this.owner("dismiss", request),
      signal = this.signal();
    return this.serialize(input.sessionId, signal, async () => {
      const { offer } = await this.readState(input.sessionId, signal);
      if (
        !offer ||
        offer.owner !== input.sessionId ||
        offer.id !== input.offerId
      )
        throw new Error("建议已失效");
      if (input.taskId && !offer.tasks.some((task) => task.id === input.taskId))
        throw new Error("任务不属于这份建议");
      const previous = this.dismissed.get(input.sessionId);
      const hidden = new Set(
        previous?.offerId === offer.id ? previous.taskIds : [],
      );
      if (!input.promptOnly)
        for (const task of offer.tasks)
          if (
            task.status === "pending" &&
            (!input.taskId || task.id === input.taskId)
          )
            hidden.add(task.id);
      signal.throwIfAborted();
      await this.dismissed.put(
        input.sessionId,
        preferenceSchema.parse({
          offerId: offer.id,
          taskIds: [...hidden],
          prompt: true,
        }),
      );
      return { dismissed: true };
    });
  }
  async change(agent, offerId, taskId, fields) {
    await this.record(
      agent.session,
      records.changed,
      changeSchema.parse({ offerId, taskId, ...fields }),
    );
  }
  async accept(request) {
    const input = this.owner("accept", request),
      signal = this.signal();
    return this.serialize(input.sessionId, signal, async () => {
      this.assertAvailable(input.sessionId);
      const { agent } = await this.ctx.sessionController.resolveAgent(
        input.sessionId,
      );
      await this.assertRoot(agent, signal);
      const offer = this.currentOffer(agent, input.offerId, signal);
      if (
        input.taskIds.some((id) => !offer.tasks.some((task) => task.id === id))
      )
        throw new Error("任务不属于这份建议");
      const results = [];
      let plan;
      for (const id of input.taskIds) {
        try {
          const item = this.currentOffer(
            agent,
            input.offerId,
            signal,
          ).tasks.find((task) => task.id === id);
          if (item.status !== "pending") {
            results.push({
              taskId: id,
              status: item.status,
              ...(item.childId ? { childId: item.childId } : {}),
            });
            continue;
          }
          const controller = new AbortController();
          const admissionSignal = AbortSignal.any([signal, controller.signal]);
          this.active.set(agent.id, {
            taskId: id,
            controller,
            ...(input.mode === "here" ? { ownRequestId: id } : {}),
          });
          if (input.mode === "isolated" && !plan)
            plan = await this.preparePlan(agent, offer, admissionSignal);
          results.push(
            await this.startOne(
              agent,
              offer,
              item,
              input.mode,
              admissionSignal,
              plan,
            ),
          );
        } catch (error) {
          results.push({
            taskId: id,
            error: String(error.message).slice(0, 1600),
          });
          break;
        } finally {
          this.active.delete(agent.id);
        }
      }
      return { results };
    });
  }
  async preparePlan(agent, offer, signal) {
    const permission = this.ctx.permissionPresets.current(agent.session);
    if (permission === "custom")
      throw new Error("自定义权限无法安全继承，请先选择原生权限预设");
    if (permission === "read-only")
      throw new Error(
        "只读模式不能创建独立工作区；可选择在这里处理，或先显式调整权限",
      );
    const environment = await this.ctx.localEnvironments.selectionFor(
      agent.id,
      signal,
    );
    const inputs = environment
      ? environment.repositories.map((repo) => ({
          key: repo.key,
          path: repo.cwd,
          worktree: true,
          from: "HEAD",
        }))
      : [{ key: "repo", path: offer.cwd, worktree: true, from: "HEAD" }];
    const planned = await preflightRepositories(this.ctx, inputs, signal);
    await this.ctx.localEnvironments.environmentFor(agent.id, signal);
    this.currentOffer(agent, offer.id, signal);
    if (this.ctx.permissionPresets.current(agent.session) !== permission)
      throw new Error("权限已改变，请重新确认");
    return { permission, environment, planned };
  }
  async startOne(agent, offer, item, mode, signal, plan) {
    if (mode === "here") {
      this.currentOffer(agent, offer.id, signal);
      await this.change(agent, offer.id, item.id, { status: "admitting" });
      try {
        signal.throwIfAborted();
        await this.ctx.sessionController.prompt(
          {
            sessionId: agent.id,
            requestId: item.id,
            mode: "queue",
            content: [{ type: "text", text: item.prompt }],
          },
          signal,
        );
        await this.change(agent, offer.id, item.id, { status: "here" });
        return { taskId: item.id, status: "here" };
      } catch (error) {
        await this.change(agent, offer.id, item.id, {
          status: "uncertain",
          error: String(error.message).slice(0, 1600),
        });
        throw error;
      }
    }
    const { permission, environment, planned } = plan;
    this.currentOffer(agent, offer.id, signal);
    if (this.ctx.permissionPresets.current(agent.session) !== permission)
      throw new Error("权限已改变，请重新确认");
    const reserved = Object.fromEntries(
      planned.map((repo) => [repo.key, "session-" + randomUUID()]),
    );
    let prepared = Object.values(reserved),
      childId;
    await this.change(agent, offer.id, item.id, {
      status: "admitting",
      preparationSessionIds: prepared,
    });
    try {
      const isolated = await createRepositoryWorkspaces(
        this.ctx,
        planned,
        signal,
        { permissionPreset: permission, sessionIds: reserved },
      );
      prepared = isolated.preparationSessionIds;
      const cwds = isolated.repositories.map((repo) => repo.cwd);
      await this.change(agent, offer.id, item.id, {
        status: "admitting",
        isolatedCwds: cwds,
      });
      this.currentOffer(agent, offer.id, signal);
      if (this.ctx.permissionPresets.current(agent.session) !== permission)
        throw new Error("权限已改变，请重新确认");
      const child = await this.ctx.nestedSessions.start({
        sessionId: agent.id,
        title: item.title,
        context: "fresh",
        cwd: cwds[0],
        wakeParent: true,
        reason: "用户确认的可选后续任务",
      });
      childId = child.sessionId;
      await this.change(agent, offer.id, item.id, {
        status: "admitting",
        childId,
      });
      const childAgent = (
        await this.ctx.sessionController.resolveAgent(childId)
      ).agent;
      if (environment)
        await this.ctx.localEnvironments.select(childAgent.session, {
          ...environment,
          repositories: isolated.repositories.map(
            ({ commit, ...repo }) => repo,
          ),
        });
      this.currentOffer(agent, offer.id, signal);
      await this.ctx.nestedSessions.sendWithSignal(
        {
          sessionId: agent.id,
          targetSessionId: childId,
          message:
            item.prompt +
            "\n\n此任务由用户确认，运行于独立工作区；只执行这份简报。分支基于本地已提交内容，不假定原任务未提交改动已复制。需要更多分工时向原主会话请求，不创建孙会话。",
        },
        signal,
      );
      await this.change(agent, offer.id, item.id, {
        status: "started",
        childId,
      });
      for (const id of prepared) {
        try {
          await this.ctx.workspaceRegistry.archiveSession(id);
        } catch (error) {
          this.ctx.logger.warn(
            "Follow-up preparation session retained: " +
              id +
              ": " +
              String(error.message),
          );
        }
      }
      return { taskId: item.id, status: "started", childId };
    } catch (error) {
      prepared = [
        ...new Set([...prepared, ...(error.preparationSessionIds ?? [])]),
      ].slice(0, 8);
      await this.change(agent, offer.id, item.id, {
        status: "uncertain",
        preparationSessionIds: prepared,
        ...(childId ? { childId } : {}),
        error: String(error.message).slice(0, 1600),
      });
      throw error;
    }
  }
  observe(session, event) {
    const active = this.active.get(session.id);
    if (!active || !scopeChanged(event)) return;
    const sources =
      event.type === "user/message"
        ? [event.data.source]
        : event.type === "agent/inbox/spliced"
          ? event.data.inserted
              .filter((message) => message.source?.kind === "user")
              .map((message) => message.source)
          : [];
    if (
      active.ownRequestId &&
      sources.length &&
      sources.every((source) => source?.rpcId === active.ownRequestId)
    )
      return;
    active.controller.abort(
      new Error("原任务上下文或权限已改变，未完成的建议启动已停止"),
    );
  }
}
for (const method of Object.keys(schemas))
  Remote(
    method === "preferences"
      ? method
      : { resources: { session: (request) => request?.sessionId } },
  )(FollowUps.prototype[method], {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer: (initialize) => initializers.push(initialize),
  });

export async function apply(ctx) {
  const preferences = await ctx.storage.domain.open(preferenceSpec);
  let service;
  try {
    service = new FollowUps(ctx, preferences);
  } catch (error) {
    await preferences.close();
    throw error;
  }
  const installed = new Map();
  ctx.effect(() => async () => {
    service.lifetime.abort(new Error("Follow-up capability unloaded"));
    for (const off of installed.values()) off();
    installed.clear();
    await Promise.all([...service.tails.values()]);
    await preferences.close();
  });
  const install = (agent) => {
    if (installed.has(agent) || agent.session.header.origin === "subagent")
      return;
    const off = agent.ctx.tools.register(
      defineTool({
        name: "propose_followups",
        description:
          "Offer up to three optional OUT-OF-SCOPE follow-up tasks for human confirmation, without executing them. Never defer work already requested by the user. Only the root coordinator offers; workers report ideas to their parent. One offer per current user/workspace scope. A short next_prompt is optional and used only as editable composer text.",
        parameters: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", required: true },
                prompt: { type: "string", required: true },
              },
              additionalProperties: false,
            },
          },
          next_prompt: { type: "string" },
        },
        output: {
          schema: { type: "object", additionalProperties: true },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        execute: (args, exec) =>
          service.propose(
            agent,
            {
              tasks: args.tasks ?? [],
              ...(args.next_prompt ? { nextPrompt: args.next_prompt } : {}),
            },
            exec.signal,
          ),
      }),
    );
    let offPrompt;
    try {
      offPrompt = agent.ctx.systemPrompt.context({
        name: "confirmed-follow-ups",
        order: 990,
        text: () =>
          "Complete the user's authorized scope fully; never defer required implementation or validation into optional suggestions. If you discover worthwhile work outside that scope, the root coordinator may call propose_followups once with up to three distinct, specific briefs. This only shows cards: do not execute those tasks until the user initiates them. Workers report ideas to the root rather than offering cards. Do not invent tasks just to fill a quota." +
          (service.promptEnabled()
            ? " You may also include one concise next_prompt for the empty composer; it is not a user message and is never sent automatically."
            : " Composer prompt suggestions are OFF; omit next_prompt."),
      });
    } catch (error) {
      off();
      throw error;
    }
    installed.set(agent, () => {
      off();
      offPrompt();
    });
  };
  ctx.on("agent/created", ({ agent }) => install(agent));
  ctx.on("agent/disposed", ({ agent }) => {
    installed.get(agent)?.();
    installed.delete(agent);
  });
  ctx.on("session/event", (session, event) => service.observe(session, event));
  for (const agent of ctx.agents.list()) install(agent);
}
