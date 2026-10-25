import z from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";
import { configValue } from "@local/dsh-shared/config";

// 功能开关已交给原生 pluginManager：条目关闭后模块不再加载，无需二次判断。
// 这里只保留没有对应插件条目的会话默认值，字段 volatile，由设置页写入后重新投影。
export const name = "enhancement-settings";
export const Config = z.object({
  ultracodeDefault: z.boolean().default(false).description("新会话默认进入 ultracode（强制工作流编排）。").volatile(),
  ultracodeCoordinatorLock: z.boolean().default(false).description("Ultracode 协调者只读与工具白名单；关闭时协调者仍可自己写文件。").volatile(),
  ultracodeLinkedWorkerDefault: z.boolean().default(false).description("Workflow 子执行者默认使用关联会话，而不是临时子代理。").volatile(),
});

class EnhancementSettings extends Service {
  constructor(ctx, config) {
    super(ctx, "enhancementSettings");
    this.config = config;
  }

  /** 没有显式会话记录的会话是否默认进入 ultracode。 */
  ultracodeDefault() {
    return configValue(this.config, "ultracodeDefault") === true;
  }

  /** 协调者是否只读（含工具白名单与 PTC 单信封）；与强制编排分开判断。 */
  ultracodeCoordinatorLock() {
    return configValue(this.config, "ultracodeCoordinatorLock") === true;
  }

  /** Workflow 子执行者是否默认使用关联会话。 */
  ultracodeLinkedWorkerDefault() {
    return configValue(this.config, "ultracodeLinkedWorkerDefault") === true;
  }
}

export function apply(ctx, config) {
  new EnhancementSettings(ctx, config);
}
