# 空闲压缩

桌面默认启用。入口：**账号菜单 → 设置 → 上下文压缩 → 空闲时压缩长会话**。开关复用原生 ConfigForms、revision 校验和 Switch，保存即时生效，关闭会取消本功能正在执行的摘要；设置页不另存一份状态。

默认条件：已加载会话空闲约 **54 分钟**，tokenMeter 估算上下文至少 **200000 token**，没有运行、待答或排队的工作。已停止或归档的会话不自动进入维护；正常新回合解除停止暂停。应用启动或重新开启后重新计时，未加载的历史不会被主动唤醒。

摘要使用该会话的模型。原始日志不变，原生 `compactNow` 替换下一次请求的活动上下文，会话显示“上下文已压缩”。正在摘要时，普通归档经过活动准入检查，“停止并归档”取消对应维护；新消息经原生 maintenance admission 排队。

## 职责

- `modules/idle-compaction.mjs`：全局策略、live 开关、计时、停止/归档准入与取消。
- `modules/idle-compaction-agent.mjs`：在角色 compaction 隔离组绑定引擎与 tokenMeter。公开的 `scopeOf` / `scopeChainOf` 选择最近 composition，不遍历 Loader 私有树。
- 四个内置角色各有独立原生引擎。只读角色没有新增 shell 或项目写入权限。
- `plugins/idle-settings`：仅提供最小设置 companion。当前宿主的插件库存页只读，需要这个 UI 包；它不实现计时、摘要、存储或另一套 RPC。

原生表单写当前 profile，源码部署仍以仓库模板为准。部署前用 `status` 检查 GUI 设置漂移，需要固定的设置同步到源配置；安装备份可恢复原 profile。不要把机器配置和测试历史推送 Git。

## 验收

`npm test` 覆盖 native schema/volatile Box、门槛、待答/队列/停止/归档、重复准入、取消、最近 scope、设置保存失败及卸载。

可选真实代理验收（需隔离 home 和本地代理 key，会产生模型请求）：

```powershell
rtk proxy node scripts/harness.mjs idle-test --home <已安装的测试目录>
```

`DSH_IDLE_SESSION` 可复用该 fixture 的测试会话；已有压缩时通过原生 fork 回到之前的完整回合，不重复发送大段种子。三个代理 runner 共用 home 级 lease，并分别锁结果目录。强制终止可能留下锁，确认记录的 PID 已退出后才移除对应 `runner.lock`；不要与同 home 的桌面窗口或其他工具并行运行。

2026-10-21，固定原生 Electron/desktop profile + 实际 proxy 通过：

- 402075 个估算 token；开关跨正常重启保存，关闭时超过测试期限不生成摘要。
- CLI 临时覆盖等待期为 60 秒，开启后真实生成 checkpoint；测试间隔不写持久 profile。
- 原始事件前缀哈希不变；原始大消息退出活动上下文，摘要保留原校验信息，模型随后没有工具调用就回答正确。
- 慢摘要期间普通归档被拒绝，“停止并归档”取消信号且没有提交摘要。
- 四个角色实际绑定四个引擎；桌面开关关闭、刷新后仍关闭、重新开启均通过点击验收。
- 原生会话显示压缩 5 条历史记录、约 356025 个估算 token，后续活动上下文约占 6%。

记录在 `.local/idle-compaction-test/`，截图在任务输出目录，不提交测试历史。没有压缩真实用户会话，也没有真实等待 54 分钟；生产默认时长由 fake-clock/配置检查验证，宿主计时以 60 秒验证。

代理缓存期限不一定是一小时。摘要会消耗 token，也可能损失细节，不能承诺费用下降；原始记录保留以供回查。
