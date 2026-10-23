import { z } from "zod";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";

export const name = "ultracode";
export const inject = ["systemPrompt", "sessionProjections", "commands"];

const RECORD = "plugin:ultracode/mode";

// ultracode 是会话内模式：开启后模型对实质性任务默认用原生 workflow
// 展开，关闭时这段策略不进入请求。它只是提示，不改变工具集、权限或沙箱。
const POLICY = `ultracode is on for this session. For every substantive task, default to dynamic orchestration with the native \`workflow\` tool: fan out independent investigations, verify findings adversarially, and keep your own context for conclusions rather than file dumps. Use a single agent for conversational turns or trivial mechanical edits. Report what the workflow actually covered, what failed, and what was truncated. ultracode does not widen permissions or bypass the file sandbox.`;

const stateSchema = z.object({ active: z.boolean().nullable() }).strict();

export const ultracodeProjection = {
  key: "ultracode",
  stateVersion: 1,
  stateSchema,
  init: () => ({ active: null }),
  apply: (state, event) =>
    event.type === RECORD && typeof event.data?.active === "boolean"
      ? { active: event.data.active }
      : state,
  wire: { viewSchema: stateSchema, view: (state) => state },
};

function defaultActive(ctx) {
  return ctx.get("enhancementSettings")?.ultracodeDefault() === true;
}

/** 会话内是否开启：显式记录优先，否则跟随设置页的新会话默认值。 */
function active(ctx, session) {
  const state = ctx.sessionProjections.stateOf(session, "ultracode");
  if (typeof state?.active === "boolean") return state.active;
  return defaultActive(ctx);
}

export function apply(ctx) {
  ctx.sessionProjections.register(ultracodeProjection);
  ctx.systemPrompt.section({
    name: "ultracode:policy",
    order: 860,
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return "";
      return active(ctx, agent.session) ? POLICY : "";
    },
  });
  ctx.effect(() => ctx.commands.register({
    name: "ultracode",
    description: "会话内 ultracode 模式：开启后实质性任务默认用原生 workflow 动态编排。/ultracode on|off|status",
    input: { hint: "on|off|status" },
    handler: (invocation) => {
      const session = invocation.agent.session;
      const current = active(ctx, session);
      const verb = invocation.rawInput.trim().toLowerCase() || "status";
      if (verb === "status") {
        return { kind: "success", text: `ultracode 当前${current ? "已开启" : "已关闭"}。` };
      }
      if (verb !== "on" && verb !== "off") {
        return { kind: "error", text: "用法：/ultracode on | off | status" };
      }
      const wanted = verb === "on";
      if (wanted === current) {
        return { kind: "success", text: `ultracode 已经是${wanted ? "开启" : "关闭"}状态。` };
      }
      appendPluginRecord(session, RECORD, { active: wanted });
      return {
        kind: "success",
        text: `ultracode 已${wanted ? "开启" : "关闭"}，从下一步请求起生效。`,
      };
    },
  }));
}
