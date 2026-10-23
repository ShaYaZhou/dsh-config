import z from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";

// Harness增强的统一开关。所有字段都是 volatile：设置页写入后立即被
// 宿主重新投影，模块通过公开服务读取当前值，不另建配置存储。
export const name = "enhancement-settings";
export const Config = z.object({
  team: z.boolean().default(true).description("Team 成员与共享任务工具。").volatile(),
  worktree: z.boolean().default(true).description("create_worktree 工具。").volatile(),
  browser: z.boolean().default(true).description("浏览器与 computer-use 的系统提示和技能。").volatile(),
  sessionBus: z.boolean().default(true).description("跨会话消息工具与 /session-bus 授权。").volatile(),
  claudeContext: z.boolean().default(true).description("注入 Claude Code 指令与规则。").volatile(),
  usageReport: z.boolean().default(true).description("usage_report 用量工具。").volatile(),
  ultracodeDefault: z.boolean().default(false).description("新会话默认进入 ultracode。").volatile(),
});

function read(config, key) {
  const raw = config?.[key];
  return typeof raw?.get === "function" ? raw.get() : raw;
}

class EnhancementSettings extends Service {
  constructor(ctx, config) {
    super(ctx, "enhancementSettings");
    this.config = config;
  }

  /** 功能是否启用；未配置时按启用处理，缺失插件时由调用方回退。 */
  enabled(feature) {
    return read(this.config, feature) !== false;
  }

  /** 没有显式会话记录的会话是否默认进入 ultracode。 */
  ultracodeDefault() {
    return read(this.config, "ultracodeDefault") === true;
  }
}

export function apply(ctx, config) {
  new EnhancementSettings(ctx, config);
}
