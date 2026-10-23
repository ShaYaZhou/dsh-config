import { z } from "zod";
import { sessionId } from "@local/dsh-shared/session-id";

export { sessionId };
export const taskInput = z.strictObject({
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(8000),
});
export const proposalInput = z
  .strictObject({
    tasks: z.array(taskInput).max(3).default([]),
    nextPrompt: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .regex(/^[^\r\n]+$/)
      .optional(),
  })
  .refine(
    (value) => value.tasks.length > 0 || value.nextPrompt !== undefined,
    "Offer at least one task or prompt",
  )
  .refine(
    (value) =>
      new Set(value.tasks.map((task) => task.prompt)).size ===
      value.tasks.length,
    "Follow-up tasks must be distinct",
  );
const status = z.enum([
  "pending",
  "admitting",
  "started",
  "here",
  "uncertain",
  "dismissed",
]);
const taskState = taskInput.extend({
  id: z.uuid(),
  status,
  preparationSessionIds: z.array(sessionId).max(8).optional(),
  childId: sessionId.optional(),
  isolatedCwds: z.array(z.string().min(1).max(4000)).max(8).optional(),
  error: z.string().max(1600).optional(),
});
export const offerSchema = z.strictObject({
  id: z.uuid(),
  owner: sessionId,
  epoch: z.number().int().min(-1),
  cwd: z.string().min(1).max(4000),
  tasks: z
    .array(taskState)
    .max(3)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  nextPrompt: proposalInput.shape.nextPrompt,
  promptReady: z.boolean(),
  promptDismissed: z.boolean(),
});
export const stateSchema = z.strictObject({
  epoch: z.number().int().min(-1),
  offer: offerSchema.nullable(),
});
export const changeSchema = z.strictObject({
  offerId: z.uuid(),
  taskId: z.uuid(),
  status,
  preparationSessionIds: z.array(sessionId).max(8).optional(),
  childId: sessionId.optional(),
  isolatedCwds: z.array(z.string().min(1).max(4000)).max(8).optional(),
  error: z.string().max(1600).optional(),
});
export const records = {
  offered: "plugin:follow-ups/offered",
  changed: "plugin:follow-ups/changed",
};
export const initialState = () => ({ epoch: -1, offer: null });

export function scopeChanged(event) {
  if (
    [
      "working-directory/change",
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
      "agent-preset/selected",
    ].includes(event.type)
  )
    return true;
  if (event.type === "user/message")
    return (
      event.data.source?.kind === "user" || typeof event.surfaceOp === "object"
    );
  if (event.type === "agent/inbox/spliced")
    return (
      ["next-turn", "next-step"].includes(event.data.target) &&
      event.data.inserted.some((message) => message.source?.kind === "user")
    );
  return (
    event.type === "turn/end" &&
    event.data.reason?.kind === "aborted" &&
    event.data.reason.reason?.kind === "user"
  );
}

export function fold(state, event) {
  if (scopeChanged(event)) return { epoch: event.seq, offer: null };
  if (event.type === records.offered) {
    const offer = offerSchema.parse(event.data);
    return offer.epoch === state.epoch ? { ...state, offer } : state;
  }
  if (!state.offer) return state;
  if (event.type === "turn/start")
    return { ...state, offer: { ...state.offer, promptReady: false } };
  if (event.type === "turn/end")
    return {
      ...state,
      offer: {
        ...state.offer,
        promptReady: event.data.reason?.kind === "completed",
      },
    };
  if (event.type !== records.changed) return state;
  const { offerId, taskId, ...change } = changeSchema.parse(event.data);
  if (state.offer.id !== offerId) return state;
  return {
    ...state,
    offer: {
      ...state.offer,
      promptDismissed: true,
      tasks: state.offer.tasks.map((task) => {
        if (task.id !== taskId) return task;
        if (
          (task.status === "pending" && change.status === "admitting") ||
          (task.status === "admitting" &&
            ["admitting", "started", "here", "uncertain"].includes(
              change.status,
            ))
        )
          return { ...task, ...change };
        return task;
      }),
    },
  };
}
