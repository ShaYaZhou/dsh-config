# 嵌套会话

适用版本：DSH 0.2.1-rc.2。标题栏的 **嵌套会话** 管理当前会话家族；左侧同名入口显示所有家族的父子树。原工作区列表继续使用 DSH 原生实现，保留搜索、置顶、归档、重命名和目录选择。

选中树中节点后可打开会话、新建子会话、继承上下文、发消息、查看近况、停止或移到顶层。树支持展开和折叠。新建时填写标题及任务；“完成后通知并唤醒父会话”默认不勾选，适合先人工检查结果。使用模型工具创建任务时默认通知父会话。

| 能力 | 实现 |
|---|---|
| 新建子会话 | 原生 create，独立 ID、上下文和持久历史；继承父会话工作区及角色，只传任务说明 |
| 继承上下文 | 原生 fork，继承最近已完成轮次的前缀；原会话保留，进行中尚未完成的轮次不复制 |
| 嵌套关系 | 插件独立 storage domain；不改写冻结的历史 header |
| 相互通信 | 家族内父子及兄弟会话可按真实 ID 发消息，来源为原生 agent-message；不伪装成用户输入 |
| 查看结果 | 读取有限历史及运行状态，不为读取而启动模型 |
| 完成通知 | 开启时回传有限结果并唤醒父会话；按结束事件序号持久去重 |
| 停止 | 取消正在执行的任务并清除待执行消息；记录人工停止标记，自动结果与 Agent 消息不得重新唤醒 |
| 继续 | 用户打开该会话并主动发送一条消息，解除停止标记 |
| 脱离 | 只移除当前父子关系；历史、子树和 fork 来源事实保留 |
| 权限 | 同一已认证原生 Gateway、SRC Remote、session resources 和 RemoteAccess；模型只能操作自己的家族 |

Agent 工具：`start_session`、`list_linked_sessions`、`send_session_message`、`read_session`、`stop_session`。例如：“创建两个独立子会话分别调查方案 A/B，完成后告诉我结论”。需要并行改代码的隔离工作区时，使用现有 Agent Team 的 `isolation=worktree`；嵌套会话默认共享工作区，不能同时修改同一文件。

## 与 Claude 的关系

截图中的功能确实称为 nested sessions。它是独立会话的组织与执行层，不等同于 Team，也不能仅凭树形外观认定为 subagent。

- 普通 subagent：一次委派的 Agent 上下文；最新 [官方 subagent 文档](https://code.claude.com/docs/en/sub-agents#resume-subagents) 已允许 SendMessage 恢复/通信，不能再笼统说只能返回一次结果。
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)：增加共享任务、成员协作及团队协议。
- [桌面多会话](https://code.claude.com/docs/en/desktop#work-across-sessions)及[跨会话消息](https://code.claude.com/docs/en/cross-session-messaging)：独立会话之间的读取、消息和管理能力。

本次只读取公开官方文档、[公开 CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 和本机安装包的离线静态内容。未启动 Claude 或 CLI，未附加进程、连接调试端口、读取私人会话/凭据，也未请求登录态接口。不复制 Claude 的源码，不连接它的本地 IPC。DSH 的实现使用自己的原生服务，可在没有 Claude 的电脑上安装。

离线调查的 Claude 产品元数据为 2.42304.2；SDK 依赖声明为 0.3.299，二者不等于 CLI 版本。安装包中观察到 `side_session`、`fork`、`hand_off`、`suggested_task` 等 lineage，fresh/fork 创建真实新会话，关系脱离和完成通知各有独立状态。没有读取截图条目的私人存储，因此不能断言每一条具体属于哪种 lineage。

REA 的后台 Evidence：`ev_97f38f33a2f2b33f6018128f97ac49d8a4435a72c0ea05dd829961281846d302`；UI Evidence：`ev_3d589d893429a1287b2623ecdc37de23a0c8c413a2738a26a6d3d38c8d818b7c`。只分析选定文件，语义图达到预算；六个未执行的 companion 文件存在声明 hash 差异并已记录，不宣称整个安装包通过完整性检查。

## 验证和边界

单测覆盖父子/兄弟关系、独立 fresh/fork、脱离保留历史、跨家族拒绝、严格请求校验、停止与消息竞争、清空排队任务、归档保护、完成回传去重和树循环保护。

真实隔离 DSH runtime 验证 create/fork/read/send/stop/detach、重启后关系/停止状态保留、脱离后历史保留。真实本机已认证 `connection.rpc.call('/api',...)` 验证成功；无 cookie 返回 401，未授权会话被 RemoteAccess 拒绝。界面创建的子会话使用本机 proxy 返回预期文本，树可查看真实历史并发送家族消息。

当前树位于同名面板和标题栏弹出面板；没有替换原生工作区列表为 Claude 的逐行嵌套样式。没有移植 Claude 云端跨机器调度、完整团队审批协议、任意 host/model/permission 的子会话表单。模型效果仍取决于 proxy 和 DeepSeek 本身。

`clean`/Git revert 后安装会卸载这项增强，但保留原生会话及插件 domain 数据；重新安装增强可恢复树。新电脑只获得程序与配置，不会拉取原电脑的会话、家族关系或记忆。
