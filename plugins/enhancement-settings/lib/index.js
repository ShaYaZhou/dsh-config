import z from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";
import { configValue } from "@local/dsh-shared/config";

// 功能开关已交给原生 pluginManager：条目关闭后模块不再加载，无需二次判断。
// 这里只保留没有对应插件条目的会话默认值，字段 volatile，由设置页写入后重新投影。
export const name = "enhancement-settings";
export const Config = z.object({
  ultracodeDefault: z.boolean().default(false).description("新会话默认进入 ultracode。").volatile(),
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
}

export function apply(ctx, config) {
  new EnhancementSettings(ctx, config);
}
