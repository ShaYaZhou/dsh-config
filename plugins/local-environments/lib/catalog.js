import { z } from "zod";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
  principalOf,
} from "@deepseek-ai/dsh-typert-protocol";
import { defineDomain } from "@deepseek-ai/dsh-storage-domain";
import { stat } from "node:fs/promises";
import {
  canonicalDirectory,
  preflightRepositories,
  createRepositoryWorkspaces,
} from "./workspace.js";
import path from "node:path";
import {
  definitionSchema,
  environmentId,
  repositoryKey,
  portableSchema,
} from "./definition.js";

export const name = "local-environment-catalog";
export const inject = [
  "typert",
  "storage",
  "localEnvironments",
  "sessionController",
  "workspaceRegistry",
  "worktrees",
  "subprocess",
];
const folder = z.string().min(1).max(4000);
const schemas = {
  list: z.strictObject({}).default({}),
  save: definitionSchema,
  remove: z.strictObject({ id: environmentId }),
  bind: z.strictObject({
    id: environmentId,
    key: repositoryKey,
    path: folder.nullable(),
  }),
  variables: z.strictObject({
    id: environmentId,
    values: z.record(z.string(), z.string()),
  }),
  export: z.strictObject({}).default({}),
  import: portableSchema,
  launch: z.strictObject({ id: environmentId }),
  recent: z.strictObject({}).default({}),
  openFolder: z.strictObject({ path: folder }),
};
const spec = defineDomain({
  name: "local_environments",
  version: 1,
  tables: {},
  global: {
    initial: { definitions: [], bindings: {} },
    schema: z.strictObject({
      definitions: portableSchema.shape.environments,
      bindings: z.record(environmentId, z.record(repositoryKey, folder)),
    }),
  },
});
const initializers = [];

export class LocalEnvironmentCatalog extends TypertRemoteService {
  constructor(ctx, domain) {
    super(ctx, "localEnvironmentCatalog");
    for (const initialize of initializers) initialize.call(this);
    this.domain = domain;
    this.tail = Promise.resolve();
    this.disposed = false;
  }
  input(method, request) {
    if (principalOf(this.ctx.invocation))
      throw new RemoteError(
        "gateway/forbidden",
        "Only the local owner may manage environments",
        {},
      );
    if (this.disposed) throw new Error("Local environments were unloaded");
    return schemas[method].parse(request);
  }
  signal() {
    return this.ctx.invocation?.signal
      ? AbortSignal.any([
          this.ctx.invocation.signal,
          AbortSignal.timeout(120000),
        ])
      : AbortSignal.timeout(120000);
  }
  serialize(operation) {
    const signal = this.signal();
    const pending = this.tail.then(() => {
      signal.throwIfAborted();
      if (this.disposed) throw new Error("Local environments were unloaded");
      return operation(signal);
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
  definition(id) {
    const row = this.domain.global
      .get()
      .definitions.find((item) => item.id === id);
    if (!row) throw new Error("Environment does not exist: " + id);
    return row;
  }
  async list(request) {
    this.input("list", request);
    return this.domain.global.get();
  }
  async save(request) {
    const input = this.input("save", request);
    return this.serialize(async () => {
      const state = this.domain.global.get();
      const definitions = [
        ...state.definitions.filter((row) => row.id !== input.id),
        input,
      ];
      portableSchema.parse({ version: 1, environments: definitions });
      await this.domain.global.set({ ...state, definitions });
      return { saved: true };
    });
  }
  async remove(request) {
    const { id } = this.input("remove", request);
    return this.serialize(async () => {
      const state = this.domain.global.get();
      await this.domain.global.set({
        ...state,
        definitions: state.definitions.filter((row) => row.id !== id),
      });
      return { removed: true };
    });
  }
  async bind(request) {
    const input = this.input("bind", request);
    return this.serialize(async (signal) => {
      const definition = this.definition(input.id);
      if (!definition.repositories.some((repo) => repo.key === input.key))
        throw new Error("The repository key is not part of this environment");
      const canonical =
        input.path === null ? null : await canonicalDirectory(input.path);
      signal.throwIfAborted();
      const state = this.domain.global.get();
      const bindings = { ...state.bindings[input.id] };
      if (canonical === null) delete bindings[input.key];
      else bindings[input.key] = canonical;
      await this.domain.global.set({
        ...state,
        bindings: {
          ...state.bindings,
          [input.id]: bindings,
        },
      });
      return { path: canonical };
    });
  }
  async variables(request) {
    const input = this.input("variables", request);
    return this.serialize(async () => {
      this.definition(input.id);
      await this.ctx.localEnvironments.setVariables(input.id, input.values);
      return { saved: true };
    });
  }
  async export(request) {
    this.input("export", request);
    return portableSchema.parse({
      version: 1,
      environments: this.domain.global.get().definitions,
    });
  }
  async import(request) {
    const input = this.input("import", request);
    return this.serialize(async () => {
      const state = this.domain.global.get();
      const merged = new Map(state.definitions.map((row) => [row.id, row]));
      for (const row of input.environments) merged.set(row.id, row);
      const definitions = portableSchema.parse({
        version: 1,
        environments: [...merged.values()],
      }).environments;
      await this.domain.global.set({ ...state, definitions });
      return { imported: input.environments.length };
    });
  }
  async launch(request) {
    const { id } = this.input("launch", request);
    return this.serialize(async (signal) => {
      const definition = this.definition(id);
      const bindings = this.domain.global.get().bindings[id] ?? {};
      const planned = await preflightRepositories(
        this.ctx,
        definition.repositories.map((repo) => ({
          key: repo.key,
          path: bindings[repo.key],
          worktree: repo.mode === "worktree",
          from: repo.baseRef,
        })),
        signal,
      );
      await this.ctx.localEnvironments.configuredValues(
        id,
        definition.requiredVariables,
        signal,
      );
      const prepared = [];
      try {
        const isolation = await createRepositoryWorkspaces(
          this.ctx,
          planned,
          signal,
        );
        prepared.push(...isolation.preparationSessionIds);
        const repositories = isolation.repositories;
        signal.throwIfAborted();
        const workspace = await this.ctx.workspaceRegistry.create(
          repositories[0].cwd,
        );
        const created = await this.ctx.sessionController.create({
          workspaceId: workspace.id,
        });
        prepared.push(created.sessionId);
        await this.ctx.sessionController.rename({
          sessionId: created.sessionId,
          title: definition.name,
        });
        const { agent } = await this.ctx.sessionController.resolveAgent(
          created.sessionId,
        );
        await this.ctx.localEnvironments.select(agent.session, {
          id,
          name: definition.name,
          requiredVariables: definition.requiredVariables,
          repositories: repositories.map(({ commit, ...repo }) => repo),
        });
        for (const sessionId of prepared.slice(0, -1))
          await this.ctx.workspaceRegistry.archiveSession(sessionId);
        return { sessionId: created.sessionId, repositories };
      } catch (error) {
        const retained = error.preparationSessionIds ?? prepared;
        throw new Error(
          "Environment launch failed; retained session IDs: " +
            retained.join(", ") +
            ". " +
            error.message,
        );
      }
    });
  }
  async recent(request) {
    this.input("recent", request);
    const signal = this.signal();
    const { items } = await this.ctx.sessionController.list({}, signal);
    const folders = new Map(
      this.ctx.workspaceRegistry.list().map((row) => [
        row.path,
        {
          path: row.path,
          title: row.title,
          updatedAt: Date.parse(row.createdAt),
        },
      ]),
    );
    for (const row of items)
      if (row.cwd)
        folders.set(row.cwd, {
          path: row.cwd,
          title: folders.get(row.cwd)?.title ?? path.basename(row.cwd),
          updatedAt: Math.max(
            folders.get(row.cwd)?.updatedAt ?? 0,
            row.updatedAt,
          ),
        });
    const rows = [...folders.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
    for (const row of rows) {
      signal.throwIfAborted();
      try {
        row.available = (await stat(row.path)).isDirectory();
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        row.available = false;
      }
    }
    signal.throwIfAborted();
    return rows;
  }
  async openFolder(request) {
    const input = this.input("openFolder", request);
    return this.serialize(async (signal) => {
      const cwd = await canonicalDirectory(input.path);
      signal.throwIfAborted();
      const workspace = await this.ctx.workspaceRegistry.create(cwd);
      return this.ctx.sessionController.create({ workspaceId: workspace.id });
    });
  }
}
for (const method of Object.keys(schemas))
  Remote(method)(LocalEnvironmentCatalog.prototype[method], {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer: (initialize) => initializers.push(initialize),
  });
export async function apply(ctx) {
  const domain = await ctx.storage.domain.open(spec);
  const service = new LocalEnvironmentCatalog(ctx, domain);
  ctx.effect(() => async () => {
    service.disposed = true;
    await service.tail;
    await domain.close();
  });
}
