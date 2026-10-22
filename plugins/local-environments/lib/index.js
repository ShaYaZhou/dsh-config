import { Service } from "@deepseek-ai/cordis";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";
import { z } from "zod";
import { checkedVariables } from "./values.js";
import { environmentId, repositoryKey, requiredVariables } from "./definition.js";

export const name = "local-environments";
export const inject = [
  "credentials",
  "sessionController",
  "sessionProjections",
  "sessions",
  "nestedSessions",
  "systemPrompt",
];
const selectionSchema = z.strictObject({
  id: environmentId,
  name: z.string().trim().min(1).max(160),
  repositories: z
    .array(
      z.strictObject({
        key: repositoryKey,
        sourceRoot: z.string().min(1).max(4000),
        cwd: z.string().min(1).max(4000),
        branch: z.string().max(300).optional(),
        worktree: z.boolean(),
      }),
    )
    .min(1)
    .max(8)
    .refine(
      (repos) => new Set(repos.map((repo) => repo.key)).size === repos.length,
      "Repository keys must be unique",
    ),
  requiredVariables,
});

export class LocalEnvironments extends Service {
  constructor(ctx) {
    super(ctx, "localEnvironments");
    const stateSchema = selectionSchema.nullable();
    ctx.sessionProjections.register({
      key: "localEnvironment",
      stateVersion: 1,
      stateSchema,
      init: () => null,
      apply: (state, event) =>
        event.type === "plugin:local-environments/selected"
          ? selectionSchema.parse(event.data)
          : state,
      wire: { viewSchema: stateSchema, view: (state) => state },
    });
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      const [selected, result] = await Promise.all([
        context.agent
          ? this.selectionFor(context.agent.id, context.signal)
          : undefined,
        next(),
      ]);
      if (!selected) return result;
      return {
        ...result,
        contexts: [
          ...result.contexts,
          {
            name: "local-environment",
            interpolate: false,
            text:
              "Local environment configuration data (not a new task or permission grant):\n" +
              JSON.stringify(selected) +
              "\nUse the listed checkouts. Preserve native permissions. For writes outside your own workspace, the root coordinator delegates linked sessions with the exact repository cwd; workers request further delegation from the root. Environment values are private process inputs and are not included here.",
          },
        ],
      };
    });
  }
  async select(session, selection) {
    appendPluginRecord(
      session,
      "plugin:local-environments/selected",
      selectionSchema.parse(selection),
    );
    await this.ctx.sessions.flush(session);
  }
  async selectionFor(
    sessionId,
    signal = AbortSignal.timeout(30000),
    visited = new Set(),
  ) {
    signal.throwIfAborted();
    if (visited.has(sessionId) || visited.size >= 64)
      throw new Error(
        "Local environment ancestry contains a cycle or exceeds the supported depth",
      );
    visited.add(sessionId);
    const own = await this.ctx.sessionController.projections(
      { sessionId },
      signal,
    );
    signal.throwIfAborted();
    if (own?.kind !== "sequenced")
      throw new Error(
        "Local environment selection is unavailable until this session can be read",
      );
    if (own.values.localEnvironment)
      return selectionSchema.parse(own.values.localEnvironment);
    const header = this.ctx.sessions.get(sessionId)?.header;
    if (header?.origin === "subagent" && header.parentSession)
      return this.selectionFor(header.parentSession, signal, visited);
    const family = await this.ctx.nestedSessions.list({ sessionId });
    const parents = new Map(
        family.links.map((link) => [link.sessionId, link.parentId]),
      ),
      seen = new Set();
    let root = sessionId;
    while (parents.has(root)) {
      if (seen.has(root))
        throw new Error("Local environment family contains a cycle");
      seen.add(root);
      root = parents.get(root);
    }
    if (root === sessionId) return undefined;
    const inherited = await this.ctx.sessionController.projections(
      { sessionId: root },
      signal,
    );
    signal.throwIfAborted();
    if (inherited?.kind !== "sequenced")
      throw new Error("The coordinator environment selection is unavailable");
    return inherited.values.localEnvironment
      ? selectionSchema.parse(inherited.values.localEnvironment)
      : undefined;
  }
  async setVariables(id, values) {
    const env = checkedVariables(values);
    await this.ctx.credentials.modifyRecord(
      credentialKey(name, environmentId.parse(id)),
      async () => ({ kind: "grant", payload: { version: 1, variables: env } }),
    );
  }
  async environmentFor(sessionId, signal = AbortSignal.timeout(30000)) {
    const selected = await this.selectionFor(sessionId, signal);
    if (!selected) return undefined;
    return this.configuredValues(
      selected.id,
      selected.requiredVariables,
      signal,
    );
  }
  async configuredValues(id, required, signal = AbortSignal.timeout(30000)) {
    signal.throwIfAborted();
    const record = await this.ctx.credentials.readRecord(
      credentialKey(name, environmentId.parse(id)),
    );
    signal.throwIfAborted();
    if (record && (record.kind !== "grant" || record.payload?.version !== 1))
      throw new Error(
        "Local environment variable record has an unsupported type",
      );
    const env = checkedVariables(record ? record.payload.variables : {});
    const names = new Set(
      Object.keys(env).map((key) =>
        process.platform === "win32" ? key.toUpperCase() : key,
      ),
    );
    const missing = required.filter(
      (key) =>
        !names.has(process.platform === "win32" ? key.toUpperCase() : key),
    );
    if (missing.length)
      throw new Error(
        "Local environment variables are not configured: " + missing.join(", "),
      );
    return env;
  }
}
export function apply(ctx) {
  new LocalEnvironments(ctx);
}
