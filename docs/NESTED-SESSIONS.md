# 嵌套会话与任务协作

适用版本：DSH 0.2.1-rc.2。嵌套会话是 Agent 用来分工的独立工作对话，人数、任务分配和模型由 Agent 自己选择。

## 怎么使用

普通任务直接在原对话中描述，Agent 按需判断是否拆分；较小任务可能直接完成，不会为了显示进度而硬开几个子会话。

明确需要独立子会话协作时，在原对话输入：

```text
/collaborate 审查当前项目的 API、安全与界面问题，最后汇总改进优先级
```

这条命令只表达“本任务启用协作”，不会指定人数、模型或代替 Agent 创建固定数量的会话。Agent 先分析任务，查询已配置模型，再自行调用 start_session 分派；子会话的真实结果返回原对话，主 Agent 收集后汇总。

也可点击标题栏 **任务协作**，填写目标并点 **交给 Agent 协作**。不需要填写子会话标题、上下文模式、数量或模型。左侧 **协作进度** 显示已有分工；点击任务标题打开完整对话，可继续补充要求。

| 操作 | 行为 |
|---|---|
| /collaborate on | 明确开启当前任务家族的协作，随后继续描述任务 |
| /collaborate off | 暂停新分工；保留已有会话和历史 |
| /collaborate auto | 恢复按需模式，较小任务可直接处理 |
| 查看结果 | 打开原生子会话阅读结果，可直接返回主会话 |
| 停止此任务 | 取消该子任务并清空待执行消息 |
| 停止所有子任务 | 暂停新分工并停止当前家族的全部子任务，保留历史 |
| 返回主会话 | 从子会话回到原任务 |

界面显示任务状态、实际使用的模型和 Agent 给出的简短分配理由。宿主重启后没有实际运行的旧任务会显示“等待继续”，不把历史 running 标记当作仍在执行的证据。

## 执行与边界

- start_session 复用原生 create/fork；fresh 只传完整 brief，fork 继承已完成轮次。不是伪装成子任务的消息列表。
- list_session_models 查询当前 provider/proxy 配置中的模型及已公开能力；工具要求 Agent 明确传入 provider/model。未配置模型在创建前被拒绝，不虚构价格、性能或可用性。
- 模型分配通过会话级 model/selection 和原生请求钩子生效；不会调用会保存全局默认值的模型切换操作。用户后来在子会话手动选模型仍然有效。
- 子会话继承父会话的原生权限预设和角色；无法安全继承的自定义权限明确拒绝。不会用新建独立会话提升权限。
- wait_for_sessions 等待实际执行并收集结果；完成/失败/阻塞通过真实终态回传去重。已人工停止的会话不得被自动结果重新唤醒。
- 家族通信使用原生 agent-message；用户在进度面板发起任务使用原生用户消息。家族权限与 RemoteAccess 校验保留。
- 并行改代码应先创建独立 worktree 并传 cwd，或使用既有 Agent Team 的 worktree 隔离；共享目录中不能同时改同一文件。

验收命令（先在隔离 DSH_HOME 安装本仓库配置，设置本机 OPENAI_API_KEY）：

```powershell
rtk proxy node scripts/harness.mjs automatic-test --home .local/test-home
```

它会产生真实 proxy 请求：通过 /collaborate 提交合成的多部分审查任务，不规定子任务数量或模型；检查 Agent 自己调用模型目录与分工工具、实际子会话请求头中的模型、权限继承、最终汇总以及全局默认模型未变。脚本不把“工具存在”或手工调用创建 RPC 当作自动协作通过。

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

原有隔离 runtime 的 create/fork/read/send/stop/detach、重启持久化及已认证 RPC 测试证明底层接口，但不足以证明自动协作体验。本次另外通过真实 proxy 的 /collaborate 完整验收：Agent 自行查询目录、选择数量和模型、创建子会话、等候实际结果并完成汇总；请求头与全局默认模型、权限继承分别校验。没有把手工创建 RPC 或仅有工具列表算作自动验收。

进度位于协作面板和标题栏弹出面板；原工作区列表仍保留原生布局。没有移植 Claude 云端跨机器调度或完整团队审批协议。按需模式不会保证每个小任务都创建子会话；明确需要协作请用命令或界面开启。Agent 可能有理由为多个子任务选择同一模型，数量和模型不是代码写死的。效果与耗时仍取决于模型和 proxy。

`clean`/Git revert 后安装会卸载这项增强，但保留原生会话及插件 domain 数据；重新安装增强可恢复树。新电脑只获得程序与配置，不会拉取原电脑的会话、家族关系或记忆。
