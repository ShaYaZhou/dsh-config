# 本机调校变更边界

以下均相对于用户的 `DSH_HOME`；不是本仓库中的硬编码部署位置。

| 本机文件/目录 | 改动性质 | 仓库来源 |
|---|---|---|
| `AGENTS.md` | 追加记忆、proxy、验证及角色使用规则；迁移后由完整模板管理 | `config/AGENTS.md` |
| `cordis.patch.yml` | 后续为可靠切换原生基线而纳入管理；增强模式保留可选的 Orca Hook，基线模式为空，旧内容先备份 | `config/global.patch.json` |
| `profiles/desktop/cordis.patch.yml` | 默认 Standard、proxy、记忆、MCP、角色、Team 和回退等配置 | `config/desktop.patch.json` |
| `profiles/desktop/package.json` | 删减插件、版本固定、本地包引用 | `config/desktop.package.json` |
| `profiles/desktop/pnpm-lock.yaml` | 包管理器生成的依赖锁 | `config/desktop.lock.yaml` |
| `profiles/desktop/pnpm-workspace.yaml` | 保留 hoisted、禁用自动补装 peer 及构建策略 | `config/pnpm-workspace.json` |
| `profiles/headless/cordis.patch.yml` | 同一 proxy、默认模型、记忆与有效 Hooks 引用 | `config/headless.patch.json` |
| `profiles/headless/package.json`、锁与 workspace 文件 | 版本匹配的 Hooks 组件及包管理输出；初轮未对其所有文件留有基线，不能逐文件证明前后差异 | 对应 headless 模板和共用 workspace 模板 |
| `profiles/desktop/agent-capabilities/*.mjs` | 14 个本地模块，见下表 | `modules/` |
| `profiles/desktop/agent-capabilities/skills/*` | 受管技能目录，见下表 | `skills/`、`.dsh/skills/` |
| `profiles/desktop/agent-capabilities/manifest.json` | 生成的来源、版本和哈希记录 | 安装器生成 |
| `local-plugins/*.tgz` | 本地调校插件；旧的重复 tgz 保留，不被加载 | 从 `plugins/` 重打包 |
| `profiles/desktop/node_modules`、`profiles/headless/node_modules` | 包管理器安装产物，不手工维护 | 按模板和锁安装 |
| `profiles/node_modules` | 指向匹配的全局 CLI 原生依赖的链接 | 安装器在本机生成 |
| `.portable-harness/state.json`、`backups/portable-harness-*` | 本次 Git 管理接管后的漂移记录和备份 | 安装器生成，不入 Git |

## 手工源码改动

| 模块/插件 | 具体补齐 |
|---|---|
| `modules/compaction-basic.mjs` | 在原生 compactNow 增加可选摘要区间与关注点，保留原事务、锁和错误处理；每次压力检查经公开服务读取用户阈值偏好，未设置时沿用原生 0.8 |
| `modules/range-commands.mjs` | 将用户消息锚点映射到 before/from 区间 |
| `modules/role-policy.mjs` | 角色权限、项目范围独立记忆和写入 guard |
| `modules/team.mjs` | 传递角色、模型、cwd，并在队友启动前创建 worktree；新增 `awaiting_approval` 状态、Lead 的 `approve`/`reject`、可选 `requireTaskApproval`、`taskGate` 回退与 `hooks`（TaskCreated/TaskCompleted/TeammateIdle，退出码 2 拦截，空闲以 steer 继续）；新增成员计划审批（提交阻塞、Lead 决定、待审只读）并把计划存为 `plugin:agent-team-local/plan` 可忽略记录；Hook 超时在 Windows 上以 `taskkill /T` 结束整棵进程树 |
| `modules/team-tools.mjs` | 暴露和校验新增 Team 参数；策略串补充共享任务流程（list→get→claim→complete）、任务审批与计划审批语义；待审计划期间用工具 guard 限制为只读白名单 |
| `modules/worktree.mjs`、`modules/worktree-tools.mjs` | 从当前官方桌面包提取的原生模块，作为可挂载本地副本；主体未改写 |
| `modules/claude-context.mjs` | 读取并注入 `~/.claude/CLAUDE.md`、项目 `.claude/CLAUDE.md` 与 `.claude/rules/*.md`，过滤 Claude 专用 RTK 段落和 `@import`；记忆只给索引路径 |
| `modules/usage-report.mjs` | 从原生会话投影汇总 token、缓存命中、上下文压力与耗时；价格只来自配置费率，缺省为 null |
| `modules/session-bus.mjs` | 用户逐对授权的会话间消息；复用原生 followup 与 agent-message relay，持久保存授权与用户停止标记 |
| `modules/browser-guidance.mjs` | 提示同时说明隔离浏览器与持久 profile 两条链路；修正模板字符串中的反引号语法错误 |
| `modules/ultracode.mjs` | 会话内 ultracode 模式：`/ultracode on|off|status` 写入可忽略记录 `plugin:ultracode/mode`，projection 恢复状态；开启时注入“实质性任务默认用原生 workflow 编排”的策略段，关闭时该段为空。默认值由“Harness增强”设置提供，不改变工具集、权限或沙箱 |
| `plugins/enhancement-settings/lib/index.js`、`lib/client.js` | 设置页「Harness增强」：原生 `settings.section` 集中 Team、worktree、浏览器指引、会话总线、Claude 上下文、用量报告六个开关与 ultracode 新会话默认值；声明子插槽 `settings.enhancement.panel`，页内四个页签为「Harness增强」「上下文压缩」「本地环境」「后续建议」。功能开关直接调用原生 `pluginManager.setPluginEnabled`：加载器条目的 `entryId` 带 `include:` 层前缀，按补丁 id 后缀匹配、写入完整 `entryId`，条目缺失或被原生标记 `readOnlyReason` 时禁用；服务端只保留 `ultracodeDefault` volatile 字段，各模块不再重复判断功能开关 |
| `plugins/shared/lib/*` | `@local/dsh-shared`：`./session-id` 的路径安全会话标识 schema、`./config` 的 volatile 读取、`./remote` 的装饰器初始化垫片；delete-session、enhancement-settings、follow-ups、local-environments、nested-sessions 共用以去重，`test/shared.test.mjs` 覆盖纯函数与 schema |
| `plugins/idle-settings/lib/index.js`、`lib/client.js` | 设置页「上下文压缩」：volatile `thresholdPercent`（默认 80，范围 20–100）、还原默认按钮与默认值提示；经 `compactionThreshold` 服务供压缩引擎读取 |
| `plugins/delete-session/lib/index.js`、`lib/trash.js` | 会话「…」菜单的删除：先停止并归档，再把会话目录整体移入 `DSH_HOME/dsh-delete-session-trash/`，不做 unlink；服务端在搬目录前重新检查 `workspace/session-activity` 为空且会话已归档，客户端检查不再是唯一准入 |
| `plugins/ultracode-control/lib/client.js` | composer 工具行、模型选择器左侧的 ultracode 药丸：读原生 `ultracode` projection，显式开关优先，未设置时回落「Harness增强」的新会话默认值；只经现有 `/ultracode on|off` 命令写入，不新增记录类型、远程方法或第二份设置；开启时渐变流光，遵循 `prefers-reduced-motion` |
| `plugins/dynamic-ui-view/lib/index.js`、`lib/client.js` | `render_widget` 工具与 `tool.call.toolview` 卡片：模型写的 HTML 片段在会话内以沙箱 iframe 渲染（不同源、CSP 禁网、片段上限 200000 字符），替代单独生成 `.html` 文件；无原生同名工具，不抢占原生 toolview。卡片经隐藏锚点用 `MutationObserver`（`hidden` 属性、子树与 `childList`）定位最外层折叠分组，把 `.dyn-widget-host` 插到分组之后再用 `createPortal` 渲染，折叠分组照常折叠而卡片独立完整显示；`height` 只作初始帧高，帧内脚本上报 `body` 实际高度并在首帧后补报几次（样式落地前会量偏小），搬移导致 iframe 重挂载时重建消息监听并主动请求重测，卡片按内容撑开（上限 2400），文档壳用 `scrollbar-gutter:stable` 防止滚动条挤宽导致高度抖动；工具描述要求片段不自带滚动容器 |
| `plugins/memory/lib/index.js` | headless 结束前等待记忆写回；移除固定十分钟合并门槛 |
| `plugins/btw/lib/index.js` | 最近 20 对旁问历史、跨进程保存、转有工具的后台会话 |
| `plugins/rewind/lib/index.js` | 文件独立回退，复用原快照日志和原生维护锁 |
| `plugins/file-links/lib/client.js` | 包装原生 `chatFileMentions.forClosing`，把消息中的普通工作区路径（含 `:行号`、`#L` 锚点）接入既有侧边栏预览；不注册同名服务、不改 CSS |
| `plugins/team-view/lib/client.js` | 侧栏 Team 面板：读取选中会话的 `agentTeam` 投影，列出成员与待审计划，经原生 `subagentchat` 资源并排打开成员；只调用公开会话接口，不读 DOM、不改会话记录 |
| `plugins/workflow-ptc/lib/index.js` | 由 0.2.1-rc.2 源码构建：规模告警、整体 token/时长预算、一层嵌套守卫、每运行 journal 与前缀续跑、`schemaRetries`（默认 5，仅最终尝试入 journal）；构造函数归一化 schemastery 丢弃的 `default(null)` 预算字段 |
| `plugins/tool-workflow/lib/index.js` | 由 0.2.1-rc.2 源码构建：工具描述补规模指引、预算、嵌套与续跑说明，并转发 `resume_from_run_id` / `budget_*` / `warnAboveAgents` |
| `scripts/align-skills.mjs` | 维护 `docs/SKILLS-ALIGNMENT.md` 附录；仅显式传 `--target` 时幂等复制技能（本机维护用）；目标为目录联接时替换成真实副本；拒绝覆盖本机独有文件 |
| `skills/think`、`skills/pua` | 从本机全局技能入仓，作为唯一来源；来源与许可证见 `docs/SKILLS-ALIGNMENT.md` |
| `skills/ponytail`、`skills/check`、`skills/handoff`、`skills/implement`、`skills/grill-me`、`skills/grill-with-docs`、`skills/grilling`、`skills/domain-modeling` | 从本机全局技能入仓，供只有 DSH 的干净环境直接复现；`grill-me` / `grill-with-docs` 的依赖技能一并入仓 |
| `skills/dynamic-ui/SKILL.md` | 渲染通道 1 改为宿主 `render_widget`（片段直接内联成会话卡片），写 `<图名>.html` 降级为宿主都没有时的兜底；交互只做本地计算，不假设宿主桥可用 |

三个插件都保留原浏览器模块、类型文件、资源和许可证。`package.json` 记录本地构建来源与版本；原生能力绑定 0.2.1-rc.2。记忆独立 MCP 启动文件中的上游机器路径示例改为了相对路径注释，不改变运行行为。

## 未修改或不纳入 Git

- 桌面可执行文件和 app.asar 没有打补丁；只读取过其实际代码。
- 初轮调校时 `DSH_HOME/cordis.patch.yml` 未改；为本次可复现的原生恢复才将其纳入模板管理。desktop 的 `compatibility.json` 没有修改。
- 全局 npm 的 dsh 通过包管理器升级至 0.2.1-rc.2，属于依赖安装产物，不提交整棵 npm 目录。
- `.config/billion-context/billion-context.json` 的临时实验修改已经恢复；Billion Context 插件从 DSH 卸载，历史压缩数据保留。
- 未修改用户 API key；真实会话、普通记忆、角色记忆、旁问历史、回退快照及测试数据不作为可迁移配置入库。
- 工作目录中的调研仓库、Python venv、临时脚本和旧报告是本次工作产物，不是日常 Harness 的部署依赖。

原机的逐文件 SHA-256 与两轮备份对比另存在仓库外的《本机变更文件清单.json》，避免把个人目录和部署历史提交到可共享仓库。
