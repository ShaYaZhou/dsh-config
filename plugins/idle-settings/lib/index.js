import z from "@deepseek-ai/schemastery";
import { Service } from "@deepseek-ai/cordis";

// 原生 compaction-basic 的 thresholdRatio 默认 0.8，且不是 volatile 字段，
// 设置表单无法直接编辑。这里用一个唯一的本地条目保存用户百分比，
// 由 compaction-basic 在每次压力检查时通过公开服务读取。
export const name = "idle-settings";
export const Config = z.object({
  thresholdPercent: z
    .number()
    .min(20)
    .max(100)
    .default(80)
    .description("上下文达到窗口的该百分比时自动压缩；默认 80，范围 20–100。")
    .volatile(),
});

function readPercent(config) {
  const raw = config?.thresholdPercent;
  const value = typeof raw?.get === "function" ? raw.get() : raw;
  return typeof value === "number" && value >= 1 && value <= 100
    ? value
    : undefined;
}

/** 把设置配置（普通值或 volatile 读取器）换算成 0–1 比例。 */
export function ratioOf(config) {
  const percent = readPercent(config);
  return percent === undefined ? undefined : percent / 100;
}

class CompactionThreshold extends Service {
  constructor(ctx, config) {
    super(ctx, "compactionThreshold");
    this.config = config;
  }

  /** 当前生效的压缩阈值比例（0–1）；未配置时返回 undefined，交由原生默认值。 */
  ratio() {
    return ratioOf(this.config);
  }
}

export function apply(ctx, config) {
  new CompactionThreshold(ctx, config);
}
