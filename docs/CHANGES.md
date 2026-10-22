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
| `profiles/desktop/agent-capabilities/*.mjs` | 13 个本地模块，见下表 | `modules/` |
| `profiles/desktop/agent-capabilities/skills/*` | 受管技能目录，见下表 | `skills/`、`.dsh/skills/` |
| `profiles/desktop/agent-capabilities/manifest.json` | 生成的来源、版本和哈希记录 | 安装器生成 |
| `local-plugins/*.tgz` | 本地调校插件；旧的重复 tgz 保留，不被加载 | 从 `plugins/` 重打包 |
| `profiles/desktop/node_modules`、`profiles/headless/node_modules` | 包管理器安装产物，不手工维护 | 按模板和锁安装 |
| `profiles/node_modules` | 指向匹配的全局 CLI 原生依赖的链接 | 安装器在本机生成 |
| `.portable-harness/state.json`、`backups/portable-harness-*` | 本次 Git 管理接管后的漂移记录和备份 | 安装器生成，不入 Git |

## 手工源码改动

| 模块/插件 | 具体补齐 |
|---|---|
| `modules/compaction-basic.mjs` | 在原生 compactNow 增加可选摘要区间与关注点，保留原事务、锁和错误处理 |
| `modules/range-commands.mjs` | 将用户消息锚点映射到 before/from 区间 |
| `modules/role-policy.mjs` | 角色权限、项目范围独立记忆和写入 guard |
| `modules/team.mjs` | 传递角色、模型、cwd，并在队友启动前创建 worktree；新增 `awaiting_approval` 状态、Lead 的 `approve`/`reject`、可选 `requireTaskApproval` 与 `taskGate`（TaskCreated/TaskCompleted 同步执行，退出码 2 拒绝） |
| `modules/team-tools.mjs` | 暴露和校验新增 Team 参数；策略串补充共享任务流程（list→get→claim→complete）与任务审批语义 |
| `modules/worktree.mjs`、`modules/worktree-tools.mjs` | 从当前官方桌面包提取的原生模块，作为可挂载本地副本；主体未改写 |
| `modules/claude-context.mjs` | 读取并注入 `~/.claude/CLAUDE.md`、项目 `.claude/CLAUDE.md` 与 `.claude/rules/*.md`，过滤 Claude 专用 RTK 段落和 `@import`；记忆只给索引路径 |
| `modules/usage-report.mjs` | 从原生会话投影汇总 token、缓存命中、上下文压力与耗时；价格只来自配置费率，缺省为 null |
| `modules/session-bus.mjs` | 用户逐对授权的会话间消息；复用原生 followup 与 agent-message relay，持久保存授权与用户停止标记 |
| `modules/browser-guidance.mjs` | 提示同时说明隔离浏览器与持久 profile 两条链路；修正模板字符串中的反引号语法错误 |
| `plugins/memory/lib/index.js` | headless 结束前等待记忆写回；移除固定十分钟合并门槛 |
| `plugins/btw/lib/index.js` | 最近 20 对旁问历史、跨进程保存、转有工具的后台会话 |
| `plugins/rewind/lib/index.js` | 文件独立回退，复用原快照日志和原生维护锁 |
| `plugins/file-links/lib/client.js` | 包装原生 `chatFileMentions.forClosing`，把消息中的普通工作区路径（含 `:行号`、`#L` 锚点）接入既有侧边栏预览；不注册同名服务、不改 CSS |
| `plugins/workflow-ptc/lib/index.js` | 由 0.2.1-rc.2 源码构建：规模告警、整体 token/时长预算、一层嵌套守卫、每运行 journal 与前缀续跑、`schemaRetries`（默认 5，仅最终尝试入 journal）；构造函数归一化 schemastery 丢弃的 `default(null)` 预算字段 |
| `plugins/tool-workflow/lib/index.js` | 由 0.2.1-rc.2 源码构建：工具描述补规模指引、预算、嵌套与续跑说明，并转发 `resume_from_run_id` / `budget_*` / `warnAboveAgents` |

三个插件都保留原浏览器模块、类型文件、资源和许可证。`package.json` 记录本地构建来源与版本；原生能力绑定 0.2.1-rc.2。记忆独立 MCP 启动文件中的上游机器路径示例改为了相对路径注释，不改变运行行为。

## 未修改或不纳入 Git

- 桌面可执行文件和 app.asar 没有打补丁；只读取过其实际代码。
- 初轮调校时 `DSH_HOME/cordis.patch.yml` 未改；为本次可复现的原生恢复才将其纳入模板管理。desktop 的 `compatibility.json` 没有修改。
- 全局 npm 的 dsh 通过包管理器升级至 0.2.1-rc.2，属于依赖安装产物，不提交整棵 npm 目录。
- `.config/billion-context/billion-context.json` 的临时实验修改已经恢复；Billion Context 插件从 DSH 卸载，历史压缩数据保留。
- 未修改用户 API key；真实会话、普通记忆、角色记忆、旁问历史、回退快照及测试数据不作为可迁移配置入库。
- 工作目录中的调研仓库、Python venv、临时脚本和旧报告是本次工作产物，不是日常 Harness 的部署依赖。

原机的逐文件 SHA-256 与两轮备份对比另存在仓库外的《本机变更文件清单.json》，避免把个人目录和部署历史提交到可共享仓库。
