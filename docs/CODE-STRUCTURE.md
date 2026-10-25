# 自写改动的职责与依赖回查

跨工作目录树显示仍集中在 `installSidebarTree`：纯 `sidebarGroups` 计算显示归属，自有导航行复用原生 `uiWorkspace.openSession` 和 `uiSession.sessionStatus`。不伪造 Workspace 成员、不移动 React 节点；自有节点与被隐藏原生行在卸载、归档、视图切换时清理或恢复。菜单用原生 `Menu` 与公开 `StoredEntry` 的五项组件/业务注入引用，在自有槽位提供原生所需的 `menuOpenState`、`shortcuts.catalog` 和 locale；不重新声明宿主独占子槽、不复制 CRUD、存储或原生源码。订阅原条目生命周期并在注入前检查成员身份，卸载时注销引用和 portal。

后续建议集中在 `plugins/follow-ups`：`state.js` 折叠提议与 admission；后端持有 owner 确认、原生偏好及工作区准备，前端复用原生 composer 槽位和 revision-guarded InputActions。模型不能确认执行。`local-environments/workspace` 公开共享原生工作树准备，`nestedSessions.sendWithSignal` 是不暴露为 Remote 的取消派发入口；不导入其他插件私有状态。详见 `FOLLOW-UPS.md`。

本地环境集中在 `plugins/local-environments`：`definition.js` 只定义便携 schema；`catalog.js` 管理 owner-only 配置与原生工作区准备；`index.js` 读取可忽略会话记录及凭据变量；`pwsh.js`/`subprocess.js` 只在原生执行边界合并本会话变量。`client.js` 的设置页和侧栏弹窗共用管理组件，导航用原生会话引用保留最近启动来源，不复制草稿。目录/ref/变量预检先于原生 worktree 创建；失败保留原生产物，不另外实现 Git 或进程管理器。

当前宿主没有公开的当前会话观察接口，返回来源的导航适配读取固定 0.2.1-rc.2 的 `uiWorkspace.selection` 内部 SnapshotStore；它不是公开 UiWorkspace 接口。升级时须重新验证或替换为公开接口。引用保留/释放和导航本身使用原生公开能力。

全局状态复用原生 Session Projection：`attention-state.js` 只折叠 turn/start 与真实 turn/end 原因，不新增会话日志或私有历史状态文件；原生 checkpoint 负责缓存，撤销插件即不再提供该投影。UI-only `attention` RPC 每次最多 20 个已有身份，只返回 id/status，逐项读取前后复核 RemoteAccess，沿用原生 projections 冷读及 RPC 取消信号。模型没有新的跨历史工具或授权入口。

状态弹层使用原生 `sidebar.footer.action` 槽位、useSessions/useSessionStatus/useWorkspaces hooks 和 uiWorkspace.openSession；不替换原会话树、不借用其他插件 DOM。关闭时不读，重开清缓存；打开期间用运行状态与用户消息时间共同校验迟到结果。Native updatedAt 不是回合版本，不能据它长期缓存完成状态。状态逻辑和用户协作/任务管理分开，保留会话内原控制。

旁问快捷键复用 BTW 自己的 SelectionAsk 和 store.ask，通过原生 shortcuts 服务注册；按可见会话与输入焦点选取弹窗，不操作主输入框状态。后端的空工具白名单不覆盖子作用域自身工具，因此在该子 Agent 的原生 `system-prompt/assemble` 返回值中清空 tools，执行 guard 继续兜底；不改变主会话工具注册或全局配置。验收脚本复用现有隔离 home/output lease，不提供产品运行服务。

跨工作区历史读取是独立于家族控制的只读接口：精确调用者的授权/版本只在服务内存保存，UI 与原生命令负责用户授权，模型没有授权工具。roster 使用原生非激活 list，正文复用既有 bounded read/inspect；异步返回前再次验证调用者版本与目标 RemoteAccess。role-policy 只放行新只读局部工具的公开名称，未改变 native restrict 的全局工具集。扩展既有生命周期验收，不新增执行/存储引擎。

后台完成通知复用真实 `turn/end` 与现有权限/停止/归档检查，完成序号仅保存在服务内存并在下一回合开始清除；不新增持久会话字段。全局 UI 请求只返回其 RemoteAccess 允许的记录，家族工具读取不包含该记录集。前端以原生会话列表订阅加轮询兜底发现结果，使用可叠加 `shell.overlay` 和已授权 Web Notification；偏好监听、订阅、轮询与系统通知均随卸载清理。通知不调用 Agent prompt/steer/followup。

并排会话集中在嵌套前端 `installSplitView`：只注册自己的资源地址/右侧标签类型，使用原生 `sessions.retain/release`、`SessionProvider` 和内嵌 `conversation.content` Factory。渲染前检查引用与目标身份一致，切换/卸载释放引用；不复制对话渲染器、输入草稿或会话存储，不用 DOM 搬运主面板。

任务与回顾只读原生 `sessionController.projections` 的精确 `todos` / `turnOutline`，不使用迁移提示作为当前进展、不另建任务或摘要存储。`progress` RPC 在读取前后复核 RemoteAccess；前端按需挂载读取组件，单次轮询、卸载清理并忽略迟到结果，不激活 Agent。

会话停止与通信竞争控制集中在 `nested-sessions` 后端，复用原生 `agent/pre-step` 的取消信号、`agent/inbox/spliced` 用户输入事件及既有串行写入队列。瞬时取消版本只存在内存；持久关系 schema 不变。显式消息走 `followup`，终态汇总走 `steer`，前端不复制消息队列。`test-session-lifecycle.cjs` 仅提供隔离合成数据的原生/代理验收，共用现有 home/output lease，不增加产品服务。

自然语言完整交付由 `skills/dsh-spec-delivery` 编排官方 CLI 和已有 linked-session 工具；不另建任务引擎、不修改官方分阶段技能。`role-policy` 仅调整该角色可使用的局部只读/通信工具，家族授权仍由 nested-sessions 服务校验。测试目录保护与同 home lease 集中于 `scripts/test-home.cjs`，命令入口和直接脚本共同调用；`test-output-lock.cjs` 提供结果单写者保护。

`test-worktree-delivery.cjs` 仅负责隔离合成项目的原生/代理验收，不提供产品 Git 操作服务。产品继续使用原生 worktree 和工作目录服务；主会话的准备、审阅和整合指引由既有协作提示与交付技能维护。恢复验收仅支持首次 revert 之前，回滚标记防止意外重放。

空闲压缩的全局策略与各角色隔离引擎通过自己的公开绑定服务协作，使用原生 scope API；归档活动和停止走 workspace 公开事件。`plugins/idle-settings` 只用原生 ConfigForms/Switch 与数值输入渲染设置页（空闲开关、压缩阈值、还原默认），不复制业务状态。详见 `IDLE-COMPACTION.md`。

Harness增强设置集中在 `plugins/enhancement-settings`：它是唯一注册根级 `settings.section` 的本地设置页，页内是五个页签：Harness增强（插件功能开关）、Ultracode（强制编排/协调者只读/默认关联执行者三个原子开关，默认关闭）与子插槽 `settings.enhancement.panel` 提供的上下文压缩、本地环境、后续建议；其他设置插件只向该插槽注册分页。功能开关直接调用原生 `pluginManager.listPlugins/setPluginEnabled`；加载器条目的 `entryId` 带 `include:` 层前缀，客户端按补丁 id 后缀匹配、写入完整 `entryId`，条目缺失或被原生标记 `readOnlyReason` 时禁用开关。服务端只保留没有对应插件条目的 `ultracodeDefault`、`ultracodeCoordinatorLock`、`ultracodeLinkedWorkerDefault` volatile 字段与公开服务 `enhancementSettings`；`modules/ultracode.mjs` 用可忽略记录 `plugin:ultracode/mode` 与 projection 保存会话内模式，并只在开关打开且该 agent 作用域内 `ctx.tools.get("workflow")` 可见时注入策略段；判据是工具可见性而非预设名，因此原生 ptc（禁用 tool-workflow）与 explore/planner/reviewer（无 delegation 组）自动不注入。

Ultracode 的三个开关在「Harness增强 → Ultracode」页签（`plugins/enhancement-settings/lib/client.js`）：强制工作流编排、协调者只读、默认关联执行者，写的是该插件自己的 ConfigForm，默认全关；会话内 `/ultracode on|off` 只覆盖第一项。原 composer 药丸 `plugins/ultracode-control` 已从桌面 bundle 列表移除，源码保留但不再加载。`plugins/dynamic-ui-view` 把模型写的 HTML 片段变成会话卡片：服务端 `render_widget` 只校验并夹取参数，客户端按 wire 工具名注册 `tool.call.toolview`，用无同源的沙箱 iframe 加禁网 CSP 隔离片段；片段校验与文档壳拼接是纯函数，与 UI 分开测试。无同源意味着父文档读不到片段高度，所以由文档壳里的上报脚本把 `body.scrollHeight` 用 `postMessage` 报给客户端，客户端校验消息来自本帧后夹取设高。卡片挂载后用 `MutationObserver` 监听 `hidden` 属性、`childList` 与子树变化，沿祖先找最外层 `hidden="until-found"` 折叠分组，把 `.dyn-widget-host` 容器插到分组之后并用 `createPortal` 渲染卡片，折叠分组保持原生行为而卡片独立显示（搬移自身产生的变化在下一轮回调收敛）；`outerHidden` 与 `requestMeasure` 是纯函数，单独测试。搬移会让 iframe 重新挂载，消息监听的 effect 因此同时依赖片段与容器状态，否则新帧的高度上报会被旧帧的 `event.source` 校验全部丢掉；文档壳用 `scrollbar-gutter:stable` 固定滚动条槽，避免内容变高时滚动条挤掉宽度再换行。这段 DOM 适配只在客户端单点实现，并固定宿主 0.2.1-rc.2。

文件路径交互集中在 `plugins/file-links`：只包装原生 `chatFileMentions.forClosing`，让助手消息里出现的普通工作区路径复用既有的侧边栏预览，产出/交付文件的匹配仍然优先。识别是纯语法判断，不探磁盘、不读会话；不注册同名服务（Cordis 会拒绝重复 `provide`）、不改 Markdown 渲染器或 CSS。该接缝固定宿主 0.2.1-rc.2 的 `chatFileMentions` 形状，升级须重新验收。

Team 治理集中在 `modules/team.mjs` 与 `modules/team-tools.mjs`：计划状态是纯数据（append/重放、`hasPendingPlan` 查询与 `TeamPlanWaiters` 唤醒），工具层只做参数校验与只读 guard，不读 UI、不直接写持久记录；计划以 `appendPluginRecord` 的可忽略记录落盘，原生冷读跳过。`hooks` 按事件名解析命令串行执行，`TeammateIdle` 只把原因 steer 回成员，不操作其会话存储。`plugins/team-view` 是纯客户端面板：读 `agentTeam` projectionValues、调 `uiWorkspace.openSession` 和原生 `subagentchat` 资源，不读 DOM 结构、不复制对话渲染器，也不改 Team 服务状态。

技能来源统一在 `skills/`，由 `scripts/harness.mjs` 整棵复制到 DSH 的 `agent-capabilities/skills/`。`scripts/align-skills.mjs` 只维护 `docs/SKILLS-ALIGNMENT.md` 附录；仅在显式传入 `--target` 时向该目录幂等复制，用于本机维护，不参与部署。该脚本只做文件比较与复制，拒绝覆盖目标里仓库没有的文件；不建软链接或目录联接，不读写会话与记忆。

`modules/claude-context.mjs` 只做有界读取和格式过滤：`readBounded`、`stripClaudeOnlySyntax`、`claudeProjectSlug` 都是纯函数，`apply` 只注册一个 `systemPrompt.context`；不写 `~/.claude`，不解析记忆内容，只注入索引路径。`modules/usage-report.mjs` 把原生 `sessionController.projections` 的四类投影映射为纯计算 `summarizeUsage`，费率只来自模块配置，不内置价格表，单个会话读取失败只标记不可用。`modules/session-bus.mjs` 的授权、停止和列表是服务层，发送只经原生 `followup` 和 `createUserMessage`；`resolveSessionPrefix` 等状态判断可独立测试，不读取目标会话内容或其他插件私有状态。三个模块都挂在顶层全局 insert：preset 会按 Agent 重复实例化插件，`session-bus` 重复打开同一 storage domain 会失败；只有工具按 Agent 注册，子代理不获得发送入口。详见 [六项能力增强](AGENT-ENHANCEMENTS.md)。

2026-10-21，针对本仓库此前提交的本地增强与本次批注修复。范围是自写功能和上游发布产物中的本地补丁，不把上游整包宣称为重新审计过的自写源码。

| 功能 | 边界和协作方式 | 本次处理 |
|---|---|---|
| `plugins/desktop-commands` | 只负责桌面 slash 入口，经原生 commandUi、uiWorkspace、conversation 服务调用现有能力 | 移除整个浏览器批注实现和 sidebarRight 依赖 |
| `plugins/browser-review` | 截图预览和批注编辑有独立控制器与状态；共享截图能力、图片消息边界，意见编码不进入独立截图流程 | 两个独立入口，不引用桌面命令或嵌套会话的私有代码 |
| `plugins/nested-sessions` | 后端持久关系、权限、工具与前端分开；`model-routing.js` 单独封装会话级路由，前端只调用已认证 RPC | 新增 Agent 自主模型选择、等待汇总及明确的协作命令；systemPrompt 现在用于动态协作策略，不再是空依赖 |
| `modules/team*`、`modules/worktree*` | domain service 与模型工具适配器分开；工具依赖相应服务，原生会话负责执行 | 保留现有职责划分；不让批注引用这些模块 |
| `modules/role-policy.mjs` | 角色的权限/记忆策略，只挂载本角色工具约束与提示 | 无跨 UI 依赖，保留 |
| `modules/range-commands.mjs`、`compaction-basic.mjs` | 命令只解析参数并调用 compaction，摘要执行保留在引擎层 | 保留现有分层 |
| 记忆、BTW、Rewind 的上游产物和本地补丁 | 沿用各插件的服务边界；不为风格统一重写第三方源码 | 本次不改行为，运行现有回归 |
| `scripts/harness.mjs`、迁移脚本 | 安装/捕获/回滚管理部署；迁移脚本通过原生持久化接口独占写入 | 新包复用既有打包及锁模板机制，不增加第二套安装器 |

不以文件数量作为解耦标准；同一短功能中共享局部状态比通用事件总线更直接。真正的边界是数据所有者、外部副作用入口和依赖方向。后续修改遵循根目录 `AGENTS.md`。

批注测试覆盖临时截图 surface 错误、拒绝不重试、比例拟合、只读 DOM 查询、图片附件登记和原会话发送。实际安全载体验收使用 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`，同时检查元素边界吸附、CSS 定位/计算样式、全屏比例、稳定 guest viewport 和编号 PNG。真实 Harness 会话另行检查图片进入原生消息及模型读图回包。

任务协作的模型路由单独维护在 `model-routing.js`：只使用公开的模型目录、会话事件和 Agent 请求钩子，既不写全局默认模型，也不负责创建任务。任务数量、分工和选择传入工具的模型由 Agent 产生，服务负责校验、权限继承及执行；UI 只发用户目标、切换模式、导航和显示进度。结果直接打开原生会话，避免在插件内再造 Markdown 渲染器。部署漂移检查同时覆盖各本地包 `lib/` 根目录 JS/MJS，辅助文件也不会漏管。

`state-store.js` 负责持久化兼容：已发布的 `nested_sessions` v1 关系结构保持原样，模型选择、状态和协作偏好写入独立 domain。原生存储的严格 schema 不会因新增字段破坏旧版本回滚读取；扩展测试数据先迁移偏好再收回旧结构。UI 不直接接触这两个 domain。

OpenSpec 直接采用官方生成的项目技能，经安装器映射到桌面技能目录；没有新的功能插件。源文件、固定版本、MIT 许可与部署映射均可审查，项目规格仍由项目自己持有。侧栏 DOM 适配只存在于嵌套会话的 `installSidebarTree`，调用原关系 RPC 与原生 workspace/session 投影；纯排序、折叠与分页判断可独立测试。截图裁剪和批注意见各自维护状态，共用图片消息边界，不把截图交给批注控制器执行。
