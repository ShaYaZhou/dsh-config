import { z } from "zod";
import { defineDomain } from "@deepseek-ai/dsh-storage-domain";

const legacyLink = z
  .object({
    sessionId: z.string(),
    parentId: z.string(),
    title: z.string(),
    kind: z.enum(["fresh", "fork"]),
    wakeParent: z.boolean(),
    lastReportedSeq: z.number().int().optional(),
    lastOutcome: z.enum(["completed", "error", "blocked"]).optional(),
  })
  .passthrough();
const legacySpec = defineDomain({
  name: "nested_sessions",
  version: 1,
  tables: {},
  global: {
    initial: { links: {}, stopped: {} },
    schema: z
      .object({
        links: z.record(z.string(), legacyLink),
        stopped: z.record(z.string(), z.boolean()),
      })
      .passthrough(),
  },
});
const detailSchema = z
  .object({
    selection: z
      .object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string().optional(),
      })
      .optional(),
    reason: z.string().optional(),
    status: z
      .enum([
        "idle",
        "queued",
        "running",
        "completed",
        "error",
        "blocked",
        "stopped",
      ])
      .optional(),
  })
  .passthrough();
const preferenceSpec = defineDomain({
  name: "nested_session_preferences",
  version: 1,
  tables: {},
  global: {
    initial: { details: {}, auto: {}, requested: {} },
    schema: z
      .object({
        details: z.record(z.string(), detailSchema),
        auto: z.record(z.string(), z.boolean()),
        requested: z.record(z.string(), z.boolean()),
      })
      .passthrough(),
  },
});

function stableLink(link) {
  return {
    sessionId: link.sessionId,
    parentId: link.parentId,
    title: link.title,
    kind: link.kind,
    wakeParent: link.wakeParent,
    ...(link.lastReportedSeq === undefined
      ? {}
      : { lastReportedSeq: link.lastReportedSeq }),
    ...(link.lastOutcome ? { lastOutcome: link.lastOutcome } : {}),
  };
}
function detailsOf(link) {
  return {
    ...(link.selection ? { selection: link.selection } : {}),
    ...(link.reason ? { reason: link.reason } : {}),
    ...(link.status ? { status: link.status } : {}),
  };
}

export async function openNestedStore(ctx) {
  const legacy = await ctx.storage.domain.open(legacySpec);
  let preferences;
  try {
    preferences = await ctx.storage.domain.open(preferenceSpec);
    // Keep the v1 relationship format readable by the previously shipped plugin after a Git revert.
    const previous = legacy.global.get(),
      settings = preferences.global.get();
    if (
      previous.auto ||
      previous.requested ||
      Object.values(previous.links).some(
        (link) => link.selection || link.reason || link.status,
      )
    ) {
      await preferences.global.set({
        ...settings,
        auto: { ...settings.auto, ...previous.auto },
        requested: { ...settings.requested, ...previous.requested },
        details: {
          ...settings.details,
          ...Object.fromEntries(
            Object.entries(previous.links).map(([id, link]) => [
              id,
              { ...settings.details[id], ...detailsOf(link) },
            ]),
          ),
        },
      });
      await legacy.global.set({
        links: Object.fromEntries(
          Object.entries(previous.links).map(([id, link]) => [
            id,
            stableLink(link),
          ]),
        ),
        stopped: previous.stopped,
      });
    }
    return {
      global: {
        get() {
          const base = legacy.global.get(),
            extra = preferences.global.get();
          return {
            links: Object.fromEntries(
              Object.entries(base.links).map(([id, link]) => [
                id,
                {
                  ...link,
                  ...extra.details[id],
                  ...(link.lastOutcome ? { status: link.lastOutcome } : {}),
                },
              ]),
            ),
            stopped: base.stopped,
            auto: extra.auto,
            requested: extra.requested,
          };
        },
        async set(state) {
          const previous = preferences.global.get();
          await preferences.global.set({
            ...previous,
            auto: state.auto ?? {},
            requested: state.requested ?? {},
            details: Object.fromEntries(
              Object.entries(state.links).map(([id, link]) => [
                id,
                { ...previous.details[id], ...detailsOf(link) },
              ]),
            ),
          });
          await legacy.global.set({
            links: Object.fromEntries(
              Object.entries(state.links).map(([id, link]) => [
                id,
                stableLink(link),
              ]),
            ),
            stopped: state.stopped,
          });
        },
      },
      async close() {
        await preferences.close();
        await legacy.close();
      },
    };
  } catch (error) {
    await preferences?.close();
    await legacy.close();
    throw error;
  }
}
