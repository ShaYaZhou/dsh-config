# 空闲压缩实现进度

`modules/idle-compaction.mjs` 是本机空闲维护策略，当前**没有在 desktop patch 注册，不会自动执行压缩**。完整需求和剩余验收见 `openspec/changes/align-nested-session-behavior/` 的 R8。

它仅使用原生 agents、tokenMeter、sessionProjections 和 compaction 服务；不引用嵌套会话或浏览器插件的私有状态。默认候选条件为加载后的会话空闲约 54 分钟、估算输入至少 200000 token、没有运行/队列消息/待答问题。真正的并发准入与持久摘要事务交给原生 `compactNow`，不是改写历史日志。配置 `enabled:false` 完全不注册调度，卸载会取消本模块发起的维护。

当前已执行 `rtk proxy node --test test/idle-compaction.test.mjs`：5 项通过，无跳过，包括真实宿主 schema 解析、关闭开关、时间/token 门槛、待答/队列排除、重复准入和取消。尚未完成原生宿主中的定时触发、真实摘要与恢复、可见开关和通知，因此不启用，也不宣称已经交付。启动时重新计算空闲时间；未加载的历史会话不会被本模块主动加载或压缩。

Claude 的一小时缓存期限不等于当前代理的缓存期限；不能据此承诺成本下降。压缩可能损失细节，启用前仍需验证原始日志保留与继续任务的行为。
