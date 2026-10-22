# 会话记忆写入策略

在会话中直接要求“本任务不写记忆”“不要写入长期记忆”或“no memory writes”，插件会阻止当前会话写入 dsh-memory 长期存储，而不再只靠模型遵守提示。

## 行为边界

- 自动轮次摘要、子代理结果摘录、压缩摘要、摘要合并，以及 memory_add/update/delete/merge/import/export/browse/rollback/sync 均受检查。
- 子会话继承父会话限制，即使它的任务提示没有重复禁令；子会话、工具结果和助手输出不能放宽父会话限制。
- 后台生成结果在写入前重新检查；导出、作用域初始化等异步路径也不能绕过检查。
- memory_read/search/review/history/stats 仍可读取已有记忆，但禁写时不会借作用域初始化写入摘要。
- 限制在此会话历史中持续生效，包含冷读、上下文清空和 fork，避免后续摘要补写先前禁止的内容。要重新开始正常记忆，使用没有禁写要求的新会话。
- 引用示例、代码块和工具输出中的禁令不作为直接用户指令。识别常见明确表达，不使用额外模型猜测用户意图。
- 一个会话禁写不会关闭整个工作区或其他普通会话的记忆；插件启动维护和纯运行诊断不属于任务事实写入。

## 实现职责

记忆插件拥有 `memoryWritePolicy` 公共服务。`inherit(parent, child)` 只在子会话添加 `plugin:dsh-memory/parent` 可忽略记录，父限制通过公开 `sessionQuery` 查询；不读取嵌套插件私有存储，不将用户任务复制到另一份策略数据库。缺少父会话、读取失败或关系循环时拒绝写入。

记忆写工具检查执行会话与作用域；有存储锁的操作在锁内再次检查。自动摘要和 consolidation 始终携带触发会话，生成期间新增禁令时丢弃结果。

独立 MCP 服务没有 Harness 会话身份，因此不声称能够继承桌面会话的策略；本边界也不替代普通文件工具的文件系统权限。

## 回归与部署

```powershell
rtk proxy node --test test/memory-write-policy.test.mjs test/nested-backend.test.cjs
rtk npm test
rtk proxy node scripts/harness.mjs install --home .local/memory-policy-test --dry-run
rtk proxy node scripts/harness.mjs install --home .local/memory-policy-test
```

测试包含禁写主会话、提示省略禁令的子会话、冷读、原生 parentSession、只读查询、所有写工具、处理中撤销、压缩/子代理摘录和正常自动摘要的正对照。实际桌面还须在新会话发送任务，检查父子写工具拒绝、任务结束后的 rollout/raw/journal/summary/state 哈希不变，并在另一个普通新会话确认自动记忆仍然工作。

源码、类型、包版本、来源记录与锁模板共同入库。真实记忆、会话、凭据、机器目录以及 Codex 的本机截图兼容补丁不入库。安装器保留备份，回滚增强后原生 persistence 仍能忽略该插件记录并打开历史。
