export function currentSessionModel(ctx, agent) {
  const selected = agent?.session
    .snapshotEvents?.()
    .findLast((event) => event.type === "model/selection")?.data;
  const route =
    selected ??
    agent?.session.requestHeader?.()?.config ??
    agent?.options ??
    ctx.agentDefaultModel.currentSelection();
  return {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort
      ? { reasoningEffort: route.reasoningEffort }
      : {}),
  };
}

export async function sessionModels(ctx, agent, requestedProvider) {
  const current = currentSessionModel(ctx, agent),
    provider = requestedProvider ?? current.provider;
  const models = await ctx.llm.listModels(provider);
  return {
    provider,
    current,
    models: await Promise.all(
      models.map(async (model) => {
        const info = await ctx.llm.resolveModelInfo(provider, model.id);
        return {
          id: model.id,
          name: model.name ?? model.id,
          ...(model.description ? { description: model.description } : {}),
          ...(info.contextWindow ? { contextWindow: info.contextWindow } : {}),
          ...(info.reasoning ? { reasoning: info.reasoning } : {}),
        };
      }),
    ),
  };
}

export async function resolveSessionModel(ctx, parent, request) {
  const inherited = currentSessionModel(ctx, parent);
  const candidate = request.model
    ? {
        provider: request.provider ?? inherited.provider,
        model: request.model,
        ...(request.reasoningEffort
          ? { reasoningEffort: request.reasoningEffort }
          : {}),
      }
    : inherited;
  const models = await ctx.llm.listModels(candidate.provider);
  if (!models.some((model) => model.id === candidate.model))
    throw new Error("所选模型未在当前宿主配置，请先查询 list_session_models");
  const resolved = await ctx.llm.resolveCallConfig(candidate);
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...(resolved.reasoningEffort
      ? { reasoningEffort: resolved.reasoningEffort }
      : {}),
  };
}

export function installSessionModel(agent, initial) {
  let assembled;
  const assembly = agent.ctx.on(
    "system-prompt/assemble",
    async (_assembly, _context, next) => {
      const selected =
        agent.session
          .snapshotEvents()
          .findLast((event) => event.type === "model/selection")?.data ??
        initial;
      const result = await next();
      assembled = selected;
      return {
        ...result,
        variables: {
          ...result.variables,
          provider: selected.provider,
          model: selected.model,
        },
      };
    },
    { prepend: true },
  );
  const request = agent.ctx.on(
    "agent/request",
    async (_payload, next) => {
      const result = await next(),
        { reasoningEffort: _previous, ...base } = result;
      const selected = assembled ?? initial;
      return {
        ...base,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort
          ? { reasoningEffort: selected.reasoningEffort }
          : {}),
      };
    },
    { prepend: true },
  );
  return () => {
    assembly();
    request();
  };
}
