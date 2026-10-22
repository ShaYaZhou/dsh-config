# DSH 与 Claude Code Agent 能力对照

- 对照对象：DeepSeek Harness 0.2.1-rc.2 + 本仓库 `tuned` 配置（deepseek-harness-config）
- Claude 侧基线：Anthropic Claude Code / Claude agent 公开文档与官方博客，抓取日期 2026-10-22（文档版本约 v2.1.30x）；agent-teams、workflows、memory、sub-agents 四页于同日重新核对
- DSH 侧数据：2026-10-22，仓库提交 `13748ac`
- 结论口径：只描述本仓库当前启用、且有源码、配置或验收记录支撑的能力；不评价模型质量，不把上游 DSH 的全部潜力算作已具备

## 一、结论摘要

1. **整体定位不同。** Claude Code 是跨形态、云端延续的托管式 agent 产品：CLI、IDE、桌面、Web、手机与 CI 共用同一引擎，云会话、远程接管、定时任务和企业治理齐全。DSH 是本地优先、模型无关、可整体发行和回滚的桌面 agent 运行时。两者不是同类产品的强弱关系，而是**广度与可控性**的取舍。
2. **DSH 仍然完全缺失的是服务与生态层**：云/多端延续、IDE 集成、CI 与托管审查服务、企业可观测与合规治理、Agent SDK、插件市场与评测、跨机器会话消息、可分享产物页与团队聊天（Artifacts / Projects / Claude Tag）、外部事件通道（Channels）。这些属于产品形态差距，不是配置能补齐的。代码审查与安全扫描已从"外部命令"变成仓库内的只读技能与启发式静态扫描，但仍没有 CI 入口和托管的多代理审查。
3. **DSH 明显较弱的是多代理治理和权限/沙箱精细度**：Team 已有共享任务、依赖、认领、成员消息与 worktree 隔离，缺计划审批动作、任务级 hook 和成员分屏；嵌套会话固定两层。权限只有 3 个预设，模板默认 `workspace-write`，最松一档 `danger-full-access` 需要主动选择。
4. **DSH 有若干 Claude 没有或做得更彻底的能力**：模型无关与按会话/子会话选模型、配置即代码的安装/回滚/漂移检测、本地优先不留云、可见父子会话树、跨工作区只读历史授权、持久旁问（btw）、空闲期压缩、内置浏览器批注、Windows 原生桌面控制、OpenSpec 规格交付闭环、本地环境定义、确认式后续任务、会话级记忆禁写。本次新增**会话间逐对授权消息**、**按会话的用量与成本汇总**、**Claude 指令文件镜像注入**，以及工作流、代码审查、安全审查、用量报告和 Claude 上下文五个技能。
5. **一句话判断**：日常本地开发与"可审计、可回滚的私人 agent 工作站"，DSH 已经够用且更可控；需要跨端接力、CI 自动化、组织治理或大规模多代理编排时，Claude Code 仍明显领先。差距的主因是产品层，而不是 harness 工具层。

## 二、评估范围与方法

### 2.1 三层拆开看

把"DeepSeek Harness agent vs Claude agent"直接对比会产生三个常见误判，本报告先把三层分开：

| 层 | 含义 | 本报告如何处理 |
|---|---|---|
| 模型层 | 推理、代码、长上下文、工具调用质量 | **不评分**。本仓库可接 DeepSeek / GLM / GPT-6，模型能力随时可换；功能验收不等于 Claude 模型质量 |
| Harness / 运行时层 | 工具、循环、子代理、压缩、权限、会话 | **主体**。可对照、可验收 |
| 产品与服务层 | 云、多端、IDE、CI、市场、治理、SDK | **主体**。差距最大的一层 |

### 2.2 证据来源

- 本仓库：`README.md`、`docs/*.md`、`config/*.json`、`provenance.json`、`modules/`、`skills/`、`plugins/*/package.json`、`test/*.test.mjs` 与 `package.json` 测试清单。
- Claude 侧：`code.claude.com/docs`（经 llms.txt 索引核对）、官方 CHANGELOG（截至 2.1.306）、官方博客（dynamic workflows）。抓取日期 2026-10-21。
- 本报告把"Claude agent"定义为公开可用的整体：Claude Code（CLI/IDE/桌面/Web/手机）+ Claude Platform（Messages API 工具、Agent SDK、Managed Agents）+ Claude in Chrome / Excel。只比较 Claude Code 会漏掉平台层，只比较平台层会漏掉交互式 harness。
- 只把"文档明确写出，且本仓库有对应实现或验收记录"的项计为能力；只有一边有文档、另一边未验证的，标注为"未验证"，而不是"有"或"无"。
- 本次没有运行 Claude 做同任务对照，也没有访问其账号或会话；Claude 侧全部结论来自公开文档，属于"能力存在性"而非"实测效果"。
- DSH 侧本次新增能力的仓库内证据集中在 `docs/AGENT-ENHANCEMENTS.md` 与 `docs/VALIDATION.md` 的 2026-10-22 一节：完整测试通过，隔离 `DSH_HOME` 安装后用安装版同一 Electron 运行时启动，取得 `ENHANCED_ACCEPTANCE_PASS`（工具注册、两套 Playwright 前缀、5 个技能解析、`/session-bus list`、系统提示装配）。该次验收**没有真实模型调用**，端到端工具执行未覆盖。

### 2.3 判定口径

- **完全缺失**：Claude 有明确实现，本仓库无对应模块、无配置入口、无验收记录。
- **弱于**：两边都有同类能力，但 DSH 在覆盖面、粒度、规模或证据强度上明显不足。
- **独有 / 更强**：DSH 有 Claude 公开文档中无等价物的能力，或在同一维度上做得更彻底。
- **未验证**：配置存在或代码可读，但没有运行时或真实模型验收记录。

## 三、能力对照矩阵

图例：✅ 有且已验收；◐ 部分具备 / 未验收；✗ 无；— 不适用。

| 维度 | DeepSeek Harness（本仓库） | Claude Code | 判定 |
|---|---|---|---|
| Shell / 文件 / 搜索 | ✅ bash/pwsh、fs、fs-search | ✅ Bash/PowerShell、文件工具 | 持平 |
| 计划模式 | ✅ plan mode + planner 预设 | ✅ plan mode + Plan 子代理 | 持平 |
| 目标保持 / 长任务 | ✅ goal 工具 + 命令，带执行时权限检查 | ✅ `/goal` 可验证完成条件，小模型判停 | 接近 |
| 子代理 | ✅ subagent / fork / list-agents / control | ✅ 子代理，可按 ID 恢复、可互发消息，默认嵌套 3 层、20 并发 | **弱（恢复/互发未验证）** |
| 多代理团队 | ✅ 本地 Team：共享任务（CAS/依赖/认领/改派）、`send_message`、`list_agents`、`wait_agent`、worktree 隔离 | ✅ Agent Teams（实验，默认关闭）：共享任务 + mailbox + 计划审批 + 门禁 hook + 分屏 | **接近，弱在审批动作与任务 hook** |
| 嵌套会话 / 状态总览 | ✅ 两层父子会话、并排分屏、待审批/计划待审/问题/停止/失败状态、跨工作区分组（元数据，20 条/批） | ✅ 子代理 + agent view 全局状态、按 ID 恢复 | 接近 |
| 本地环境 / 多仓库 | ✅ 保存多仓库 + worktree + 只写变量，便携定义导入导出，启动独立会话 | ◐ worktree、`--add-dir`、Projects；无同等环境定义与变量管理 | **DSH 更强** |
| 后续建议 / 确认式派发 | ✅ `propose_followups` 只提议；owner 确认后独立 worktree 启动或排入当前会话，Tab 采纳草稿 | ✅ 桌面建议提示、采纳后排入 | 接近（DSH 强在确认前不执行） |
| 工作流编排 | ◐ 原生 `workflow-ptc`：本仓库配置并发 6、单次最多 64 个子代理（原生默认按 CPU 自动 / 1000），`agent()` 支持 `schema`；无检查点、续跑、嵌套、整体时长/token 预算，运行时未验收 | ✅ JS 编排、schema（失败重试 5 次）、同会话断点续跑、默认 16 并发（可调 1–256）、单次最多 1000 代理 | **弱（规模已固定，治理未验证）** |
| 程序化工具调用 | ✅ PTC 运行时（`dsh-ptc-runtime`、`workflow-ptc`） | ✅ programmatic tool calling + code execution 组合 | 接近 |
| 会话间消息 | ◐ Team / 任务家族内部 + `session-bus` 同机逐对授权（目标须运行、非子代理、未归档、未被用户停止；单条 16000 字符） | ✅ 本机/跨机/云，accept/hold/refuse | **部分缺失（跨机器）** |
| 后台任务 | ✅ jobs + 后台完成通知 | ✅ agent view、`--bg`、独立配额、JSON 状态 | 接近 |
| 定时任务 | ◐ schedule 工具（本机） | ✅ 云托管 routines：cron + API + GitHub 触发，关机仍跑 | **弱** |
| 跨端延续 | ✗ | ✅ Web / 手机 / 桌面 / teleport / Remote Control / Dispatch | **缺失** |
| IDE 集成 | ✗ | ✅ VS Code / JetBrains 扩展 | **缺失** |
| CI / GitHub | ✗ | ✅ GitHub Actions、PR 审阅、Auto-fix、GitLab CI | **缺失** |
| 代码审查 / 安全 | ◐ 只读技能 `dsh-code-review`；`security-review` + 12 条正则规则扫描；无命令参数分级、无结构化 findings、无 CI 门禁 | ✅ `/code-review`（可调 effort、`--comment`/`--fix`）、ultrareview、Claude Security（SARIF）、security-guidance | **弱（本地能力已有，治理与证据不足）** |
| Computer use | ✅ Windows 原生 UIA + Playwright 隔离浏览器 | ✅ macOS CLI + 桌面（macOS/Win），逐应用授权 | 各有侧重 |
| 浏览器 | ◐ 两条 Playwright 链路（隔离 / 独立持久 profile）；内置批注（CSS 定位 + 计算样式 + 编号截图） | ✅ Claude in Chrome（真实登录态） | **弱在真实登录态，强在批注交付** |
| 记忆 | ✅ 14 个 `memory_*` 工具、三级作用域、BM25 + 可选向量、MCP 服务；会话级禁写强制覆盖自动摘要与写工具并继承到子会话；`claude-context` 镜像注入 Claude 侧 CLAUDE.md 与 rules（有截断与过滤） | ✅ 四层 CLAUDE.md + `.claude/rules` 路径规则 + `@import` 递归 4 层 + 按仓库自动记忆（`MEMORY.md` 前 200 行/25KB）；无同等会话级禁写开关 | **接近；DSH 强在禁写边界，弱在注入预算与跨域检索** |
| 权限 | ◐ 3 预设（模板默认 workspace-write；只读 / 工作区写 / 完全访问） | ✅ 6 模式 + allow/deny/ask + 分类器 + dontAsk | **弱** |
| 沙箱 | ◐ sandbox-policy 三档，OS 级隔离未见验收 | ✅ macOS/Linux/WSL2 OS 级文件+网络代理；原生 Windows 无沙箱 | **弱（证据不足）** |
| Hooks | ◐ 兼容层按目标机器上 Hook 文件是否存在启用，仓库不含 Hook 内容 | ✅ 30+ 事件、5 类执行器 | **弱** |
| 技能 | ✅ 原生 `skill-filesystem` + `tool-skill`；13 个受管技能（7 个本地 + 6 个 OpenSpec），安装器自动发现 `SKILL.md` 与同目录资源；技能的实际模型调用未验收 | ✅ 渐进披露、`context: fork`、插件/账号同步 | 接近 |
| 插件生态 | ◐ 市场 UI 存在，模型侧工具禁用；无评测/治理 | ✅ 市场、mods、插件评测、企业策略 | **弱** |
| MCP | ✅ 客户端（含两个 Playwright 服务） | ✅ 三种传输 + OAuth + tool search + 大结果落盘 | **弱（未验证认证）** |
| 回退 / 检查点 | ✅ rewind：会话/文件/两者，code-only 走快照日志 | ✅ 100 个检查点、定向摘要、明确排除项 | 接近，语义不同 |
| 压缩 | ✅ 自动 + 工具结果剪枝 + 区间摘要 + **空闲压缩** | ✅ 自动压缩 + 定向摘要 | **更强（空闲维度）** |
| 可观测性 / 成本 | ◐ 原生 detailed usage/performance 面板 + `usage_report` 按会话归因 token、缓存命中、上下文压力与耗时；费用需手工配置费率；无 OTel、按工具/技能归因、预算告警 | ✅ OTel 指标/事件/追踪、`/usage` 归因、`/insights`、Analytics API | **弱** |
| 企业治理 | ✗ | ✅ 托管设置、网关、Bedrock/Vertex/Foundry、ZDR/HIPAA | **缺失** |
| SDK / 可嵌入 | ✗ | ✅ Agent SDK | **缺失** |
| 模型选择 | ✅ DeepSeek / GLM / GPT-6，按会话/子会话 | ✗ 仅 Claude 模型 | **DSH 独有** |
| 分发与回滚 | ✅ install/status/capture/rollback/clean + 漂移哈希 + provenance | ◐ 托管设置，无同等回滚/漂移检测 | **DSH 更强** |

## 四、Claude 有、DSH 完全没有的能力

按"对实际工作影响"排序：

### 4.1 云与多端延续

Claude Code 的同一会话可在 CLI、桌面、Web、手机、IDE 间迁移：`--cloud` 起云会话、`--teleport` 拉回本地、Remote Control 让手机当窗口、Dispatch 从手机派活。DSH 是本机 Electron 应用，会话与文件系统强绑定，没有远端执行面。**影响**：离开机器就只能中断；多人/多设备接力不可行。

### 4.2 IDE 集成

Claude 有 VS Code / JetBrains 扩展，把会话、diff 与编辑器上下文接在一起。DSH 只有桌面应用，代码理解依赖 fs 搜索与模型本身。**影响**：大型仓库的符号级导航与"编辑器里直接改"的闭环弱一档。

### 4.3 CI、托管代码审查与安全服务

Claude 有 `anthropics/claude-code-action`、PR 逐行审阅与 check run、CI 失败自动修复、GitLab CI 集成；会话内还有 `/code-review`（可调 effort、`--comment`、`--fix`）、ultrareview（云沙箱多代理审查并独立复现，约 15–25 分钟）、Claude Security 插件（架构映射、威胁建模、SARIF 报告）与 security-guidance（编辑时模式匹配 + 每轮 diff 审查）。

DSH 现在有本地只读能力：`dsh-code-review` 技能按正确性、回归、权限、资源等维度审查，要求给出 `file:line` 并做对抗自检；`security-review` 技能配合同目录 `scan.mjs`，用 12 条正则规则检查私钥、云与代码托管平台凭据、URL 内嵌凭据、硬编码密钥、关闭 TLS 校验、777 权限、`shell: true`、`eval`/`new Function`、`innerHTML` 赋值。但仓库没有 CI workflow，`--fail-on low|medium|high` 未接入任何流水线；扫描是线索级正则，没有依赖审计、熵检测、污点/数据流分析、基线豁免或 SARIF 输出；两个技能也没有真实模型端到端记录（2026-10-22 的验收止于原生装配层）。**影响**：合并前的团队质量门禁仍然缺失。

### 4.4 企业可观测与治理

Claude 导出 OTel 指标/事件/追踪，`/usage` 按 skills、子代理、插件、MCP 服务器归因成本，并有 Analytics/Compliance API、托管设置、网关、Bedrock/Vertex/Foundry、ZDR/HIPAA/CMEK。

DSH 有原生 detailed usage/performance 面板，以及 `usage_report` 工具：读取原生会话投影，按会话汇总四项 token、缓存命中率、上下文压力、轮次与 `llmMs`/`toolMs`/`ttftMs`，单次最多 20 个经 `remoteAccess` 检查的会话；费用只在配置每百万 token 费率后估算，未配置时为 `null`。它没有 OTel/指标导出、按工具/技能的自动归因、预算告警、组织级策略下发或合规审计。**影响**：能回答"这个会话用了多少 token"，但答不了"贵在哪个技能或工具"，也无法满足团队/合规审计。

### 4.5 Agent SDK

Claude 可把同一套工具与权限作为 SDK 嵌入自有服务。DSH 是桌面运行时，插件是 cordis 模块，没有对外 SDK。**影响**：不能把 DSH 当组件集成进别的系统。

### 4.6 插件市场、mods 与插件评测

Claude 有市场、`claude plugin eval`（对比无插件基线）、`plugin validate`、mods（可改界面的进程内模块）、企业允许/阻断策略。本仓库禁用了模型侧的 plugin-manager/market 工具，插件只能靠宿主管理器或手工部署；虽然锁定加载了 dshmarket、better-sidebar、code-review、skills-manager 等第三方 bundle，但仓库不含源码、也没有回归记录。**影响**：扩展靠手工维护，缺分发、静态校验与质量评估。

### 4.7 跨机器消息与入站策略

Claude 的 ListAgents / SendMessage 能让不同会话（本机、其他机器、云端）互相发消息，支持 `notify_when_idle` 与入站 accept/hold/refuse。

DSH 的模型可见消息通道有三条：Team 内的 `send_message`、任务家族内的 `send_session_message`，以及 `session-bus` 的同机逐对授权消息。`session-bus` 的授权与撤销只能由用户在**发送方会话**执行，模型只有 `message_session`（发送）与 `list_authorized_sessions`（只读列出）；可发送目标须是未被归档、正在运行、非原生子代理、且未被用户停止的本地会话，单条上限 16000 字符，反向发送需要另一条授权。仍不能跨机器或跨云，也没有入站 accept/hold/refuse 与 `notify_when_idle`。**影响**：同机并行会话可以主动协调，跨设备仍只能靠人。

### 4.8 Channels（外部事件推入会话）

Claude 可把 Telegram / Discord / iMessage / webhook 事件作为会话输入。DSH 无对应入口。**影响**：无法做"事件驱动的常驻 agent"。

### 4.9 团队计划审批与任务门禁

Claude Agent Teams 支持 teammate 先进入只读计划模式：计划完成后向 lead 发审批请求，默认由 Claude Code 直接放行（用户手动把该成员切进计划模式时改由 lead 审阅）；并由 TeammateIdle / TaskCreated / TaskCompleted 三个 hook 做质量门禁。DSH 的本地 Team 已有共享任务（`team_task_create/list/get/update`，带 revision CAS、依赖、认领/完成/重开/改派、建议写范围），但**没有计划审批动作，也没有任务级 hook**。嵌套会话一侧已能把子会话的"待审批 / 计划待审"呈现到侧栏并打开决策卡片，也能记录拒绝结果，但这是把原生审批状态**展示出来**，不是给 Team 任务增加审批门禁。**影响**：任务可以分工，但不能在"动手前"强制卡一道审批，也无法在任务完成时自动跑校验。

### 4.10 桌面级功能面

Claude 桌面有逐文件 diff + 按行评论回传、PR CI 监控、SSH 远程会话、隔离 worktree 会话、多 teammate 分屏。DSH 桌面有嵌套会话分屏、任务/回顾、浏览器批注、确认式后续任务、本地环境与跨工作区状态分组，但没有 diff 行内评论与远程会话，Team 成员也没有独立分屏视图（分屏只覆盖嵌套会话）。**影响**：多方并行时，Team 成员的进度仍只能在主界面看。

### 4.11 平台化能力（Claude Platform 层）

Claude 在 harness 之外还有一整层平台能力：Messages API 的服务端工具（web search / web fetch / code execution / tool search / advisor / MCP connector）、Managed Agents（云或自托管沙箱、会话事件流、最多 25 个活跃子线程、multiagent 配置、memory stores 与 Dreams 整理）、Agent SDK（把同一套 agent loop 嵌入自有服务）、prompt caching、服务端压缩与 context editing、task budgets、structured outputs、Files API、MCP tunnels、Message Batches（约为同步价 50%），以及 Chrome / Excel / Microsoft 365 的侧边栏形态。DSH 侧对应的是本机 shell、自带 web 工具、PTC 运行时与本地插件；没有服务端托管沙箱、批处理、缓存计费与预算收敛机制。**影响**：DSH 适合"人在机器前的交互式工作"，不适合"平台化的批量代理服务"。

### 4.12 产物与协作产品面

Claude 把会话产出发布为 claude.ai 上的 Artifacts（原地更新、版本、分享、评论，可经查看者的 MCP 拉实时数据），用 Projects 协调多条并行云线程，用 Claude Tag 在 Slack 里以组织身份工作，用 Mods 在进程内改写 Claude Code 自己的界面与工具调用。DSH 的交付物是工作区文件与浏览器批注图片；没有可分享的托管产物页、跨线程协调层、团队聊天入口或界面级 mod。**影响**：产出需要自己找地方托管，团队协作仍停在"人发文件"。

## 五、两边都有、但 DSH 明显较弱的能力

### 5.1 多代理编排：协议接近，治理与规模落后

三层能力逐项对照：

| 层 | DSH | Claude Code |
|---|---|---|
| 子代理 | `subagent` / `fork` / `list-agents` / `control`；按 ID 恢复与子代理之间互发消息未验收 | 可按 ID 恢复（`SendMessage`）、可按名字互发消息；默认向下嵌套 3 层（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`，设为 1 关闭），默认 20 个并发 |
| 团队 | 本地 Team：共享任务带 revision CAS、依赖、认领/完成/重开/改派、建议写范围（advisory，非锁）；`send_message` 在步边界 steer 或唤醒、`wait_agent`、`spawn_teammate` 支持独立 model / preset / worktree；默认 16 名成员、256 个任务、单条消息 64 KiB | Agent Teams（实验，默认关闭，需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：共享任务列表 + mailbox + 计划审批 + `TeammateIdle` / `TaskCreated` / `TaskCompleted` 门禁 hook + in-process/分屏两种显示；成员无硬上限（建议 3–5）；限制：每会话一支团队、团队不能嵌套、不能转移 lead、`/resume` 不恢复 in-process 成员 |
| 工作流 | 原生 `workflow-ptc`：本仓库配置为 `provider: spawn`、并发 6、单次最多 64 个子代理（原生默认并发按 CPU 自动、单次 1000），`agent()` 支持 `schema`；无检查点、恢复、嵌套，无整体时长/token 预算 | 动态工作流：JS 脚本（`agent` / `pipeline` / `parallel` / `phase` / `args`）、`schema` 校验失败重试 5 次、单次调用最多 4096 项、默认 16 并发（可调 1–256）、单次最多 1000 个代理、同一会话内断点续跑、超过 25 个代理或预估 150 万 token 时提示 Large workflow |

- **DSH**：Team 只在 desktop profile 提供，只有 lead 能 spawn，`wait_agent` 超时限制 10 秒–1 小时；Team 成员是 subagent，不会出现在嵌套会话树里。嵌套会话是另一套机制，最多两层，`wait_for_sessions` 最多等 60 秒，`read_session` 默认取最后 12 条（最多 40 条、正文截 16K 字符），并带跨工作区状态分组（仅元数据、每批 20 条）、跨 cwd 的侧栏血缘、取消传播，以及经记忆插件公开服务继承的禁写边界。工作流的上限已由配置与单测固定，但运行时行为没有仓库内验收，子级也不继承父会话的 cwd、preset 或 reasoning effort。
- **Claude**：subagent / Agent Teams / dynamic workflows 是三层递进，各有明确的规模与中断语义；工作流把中间结果留在脚本变量里，不占主上下文，对抗验证、多角度评审这类质量模式可以写进脚本复用；Team 的成员是独立会话，可在 UI 里直接对话、按名字互发消息。
- **差距性质**：协议层（共享任务、消息、worktree 隔离）DSH 已接近；差距集中在两处——**治理**（计划审批、任务级 hook、按 ID 恢复、成员级 UI 与分屏）与**规模**（没有断点续跑和预算收敛；并发 6 / 单次 64 是本仓库的配置值，原生默认按 CPU 自动 / 1000，而 6 是为手工 subagent 保留原生 `maxActiveSubagents` 默认 8 中的 2 个槽位）。成熟度是反向的：Claude 的 Teams 仍是实验特性、默认关闭；DSH 的 Team 是常规配置。但 DSH 的 Team 与嵌套会话仍是两套并列机制，Claude 已是三层递进。

### 5.2 权限与审批粒度

- DSH：`read-only` / `workspace-write` / `danger-full-access` 三档，配 approval 策略；仓库模板默认 `workspace-write`。
- Claude：default / acceptEdits / plan / auto（分类器审查）/ dontAsk（CI）/ bypassPermissions；allow/deny/ask 规则可叠加，deny 恒生效；受保护路径、附加目录、托管策略、`disableBypassPermissionsMode`。
- **差距性质**：DSH 的粒度不足以表达"允许 `git *` 但拒绝 `git push`"这类规则，也没有 CI 用的"只放行预批准工具"模式。

### 5.3 沙箱证据

- DSH 有 `sandbox-policy` 三档，但仓库文档没有给出与 Claude 同级的**操作系统强制**验收（文件写入边界、网络出口白名单、子进程继承）。
- Claude 明确：macOS/Linux/WSL2 由 OS 强制，网络经本机代理按域名校验；原生 Windows 不沙箱（这一点两边一样）。
- **差距性质**：不是"没有"，而是"没有证据"。在把 DSH 用于不可信代码前，这是必须补的验收项。

### 5.4 记忆与 Claude 指令注入

- **DSH**：本地补丁 0.5.1-local.1 提供 14 个 `memory_*` 工具（读/写/改/删/搜/合并/审阅/导出/导入/统计/浏览/历史/回滚/同步）、global/workspace/project 三级作用域、BM25 + 字符 bigram 容错 + 可选远端 embedding、独立 MCP stdio 服务、注入前脱敏。`memoryWritePolicy` 让"本任务不写记忆"成为**执行约束**而不是提示词约定：自动摘要、子代理摘录、压缩、合并与全部写工具都会检查，子会话继承父限制且不能放宽，后台生成结果写前复查，只读工具不会借作用域初始化写入。注入侧偏紧：只自动拼接 global 与 workspace；开启 `scopedMemory` 后 global 预算变成 `maxBytes - scopeMaxBytes` = **2000 bytes**，再受 `injectTokens: 2400` 限制；project 记忆必须显式检索，作用域之间不能互查；摘要回滚只支持 global；原始存储仍是明文，脱敏是启发式。原生 `dsh-agent-instructions` 另读项目根到 cwd 的 `AGENTS.md` / `CLAUDE.md`。
- **DSH 的 `claude-context` 镜像**：把 Claude 侧指令文件注入系统提示——用户级 `~/.claude/CLAUDE.md`、项目级 `<cwd>/.claude/CLAUDE.md`、`<cwd>/.claude/rules/*.md`（只读直接 `.md`、按文件名排序），预算 24000 / 24000 / 合计 24000，单条规则 8000；过滤 RTK 标题段和单独成行的 `@import`，项目记忆只注入 `MEMORY.md` 索引路径。它是**不完全等价的镜像**：会按上限截断、不展开 `@import`、只处理 home 与当前 cwd、不读托管层，也不加载子目录里的文件。
- **Claude**：指令文件分四层（托管策略 / `~/.claude/CLAUDE.md` / `./CLAUDE.md` 或 `./.claude/CLAUDE.md` / `./CLAUDE.local.md`），启动时把根到 cwd 的文件按层级拼接载入，子目录文件在首次读到那里的文件时按需加载；`@path` 导入最多递归 4 层；`.claude/rules/*.md` 可用 `paths` glob 只对匹配文件生效，个人规则放 `~/.claude/rules/`；建议单文件 200 行以内，超过 4 MiB 直接跳过；`/context` 列出实际载入的文件，`InstructionsLoaded` hook 可审计加载过程，`claudeMdExcludes` 可排除祖先目录的文件。自动记忆按仓库存储（同仓库的 worktree 共享、仅本机），每次会话只载入 `MEMORY.md` 前 200 行或 25KB，其余主题文件按需读取；子代理不继承主会话的自动记忆（fork 除外），子代理自己的记忆用 `memory: user|project|local` 单独开启。
- **差距性质**：DSH 强在**检索、作用域与写入边界**——Claude 把 CLAUDE.md 与自动记忆明确定位为"上下文，不是强制配置"，需要硬阻断时要另配 PreToolUse hook；DSH 的 `memoryWritePolicy` 是执行层约束。Claude 强在**层级完整性与可审查性**——四层指令、路径规则、递归导入、子目录按需加载，加上 `/memory`、`/context`、`InstructionsLoaded` 的可视化与审计，全部是明文进 Git 的文件。继续对齐的方向：DSH 补 `@import` 展开与子目录按需加载，并调大 `maxBytes` / `injectTokens`；`claude-context` 只能算过渡镜像，不是同一套解析器。

### 5.5 可观测性与成本

DSH 桌面开了原生 `performanceUsage=detailed` 与账号页 `usage=detailed`，能看到宿主给的总量与性能信息，memory 插件还有 `memory_stats`（摘要版本、超预算、LLM 调用耗时/失败、锁归属）。新增的 `usage_report` 工具读取原生会话投影（`tokenUsage`、`contextPressure`、`sessionStats`、`modelSelection.lastUsed`），按会话给出四项 token、缓存命中率 `cacheRead/(uncachedInput+cacheRead)`、上下文压力与窗口、`projectedTokens`、`llmMs`/`toolMs`/`ttftMs`、轮次与步数；单次最多 20 个会话，每个都做 `remoteAccess` 检查，单个失败只标记 `unavailable`。费用只在模块配置了每百万 token 费率时估算，未配置为 `null`，并计入 `unpricedSessions`。

但**没有** OTel 导出、按工具/技能的自动归因、预算告警、Analytics API；端到端工具调用也没有在真实会话中实跑。Claude 的 `/usage` 能指认"哪个 skill / 子代理 / MCP 服务器最贵"，并对 Agent Teams（约 7 倍 token）和大型工作流给告警。**影响**：DSH 上多代理用得越多，越难判断值不值。

### 5.6 浏览器与登录态

DSH 的桌面配置有两个 Playwright MCP 服务，`--browser` 参数都写作模板令牌 `${BROWSER}`，安装时按本机 settings 的 `browser` 渲染（默认 `chrome`，允许 `chrome`、`msedge`、`chromium`、`firefox`、`webkit`）。`mcp__playwright__*` 用 `--isolated` 启动全新隔离浏览器；`mcp__playwright-session__*` 使用独立持久 profile `DSH_HOME/browser-profiles/playwright-session`，输出到 `DSH_HOME/browser-output-session`，需在该窗口单独登录一次，不复制日常浏览器或其它 profile 的 cookie，也不是安全边界。Claude in Chrome 可用真实浏览器配置。**影响**：需要登录的内部系统，DSH 仍要单独登录或走 CUA 操作真实窗口。

### 5.7 Hooks 覆盖面

DSH 通过 `@deepseek-ai/dsh-hooks-claude-code` 兼容层读取 Claude Code 格式的 Hook：headless 读 `DSH_HOME/claude-hooks.json`，全局读本机的 agent-hooks 配置。安装器按文件是否存在决定 enabled/disabled，因此适配器是否启用取决于目标机器；**Hook 内容不在仓库、未纳入版本控制**，换机或重装后不会自动恢复。Claude 有 30+ 事件、command/HTTP/MCP/prompt/agent 五类执行器、matcher 正则与参数过滤。**影响**：DSH 的护栏依赖仓库外的配置文件，覆盖的事件集也小得多。

### 5.8 平台覆盖与稳定性证据

- 本仓库所有验收以 **Windows** 为主；`docs/BROWSER-COMPUTER-USE.md` 明确"Windows 已验证"，跨系统未逐一验收。
- 原生 `plugin peers check` 仍因 peer 布局不匹配返回 1（`docs/VALIDATION.md`），意味着插件与宿主版本是**强绑定**的，升级需要重新验收。
- 本次新增的三个模块与五个技能只验证到装配层，没有真实模型调用。
- Claude 的 macOS/Linux/Windows/WSL2 路径更成熟。

### 5.9 回退语义：机制细，覆盖窄

- DSH rewind 走原生快照日志：`write`/`edit` 在工具执行前捕获 before 备份、成功后按最近用户消息 seq 归档，恢复前写 intent journal 并支持崩溃恢复；支持 chat / both / code 三种模式，每会话保留 100 个锚点组，单文件上限 8 MiB，symlink/硬链接跳过，store 版本不认识时禁用文件恢复。
- 关键限制：**只跟踪 `write` / `edit`**。通过 bash/pwsh、`apply_patch`、MCP 工具或外部进程产生的改动不会进快照；`code` 模式必须先取消运行中的 agent 并等 idle，有排队工作时会被维护锁拒绝，且 UI 只提供 chat / both，code 只能靠 `/rewind @<seq> code`。
- Claude 的边界类似（Bash 改动不跟踪、子代理编辑通常不恢复、约 30 天清理、100 个检查点），但它把这些限制写在文档里，并在 UI 中提供"从此处摘要 / 摘要到此为止"。
- **差距性质**：两者都不能替代 Git。DSH 的崩溃恢复更细，Claude 的 UI 与文档边界更清楚。

### 5.10 headless profile 功能面明显更小

desktop profile 有 MCP、Team、worktree、plan mode、tool-result pruner、区间摘要、空闲压缩、嵌套会话、只读角色，以及本次新增的三个模块与技能；headless 只装 `dsh-base + dsh-headless`，模板仅补模型、权限、Hook、credentials 与记忆，且记忆插件的路径解析到 desktop 的 `node_modules`。**影响**：无人值守与批处理场景无法复用桌面侧能力，现阶段不能把 DSH 当"无头 CI worker"用。

### 5.11 最松权限档需要主动选择

三档预设本身没问题，模板默认是 `workspace-write`；`danger-full-access` 配 `approval: never`，选到这一档时几乎没有审批摩擦，也就没有护栏。Claude 的默认是 Manual/auto 审查。**影响**：DSH 的安全性更依赖用户自觉选档，但这已不再是模板默认状态。

## 六、DSH 有、Claude 没有（或更强）的能力

### 6.1 模型无关与按会话路由

同一份配置里并列 DeepSeek V4.1 Flash（1M 上下文 / 393K 输出）、GLM-5.3 Flash、GPT-6.1 Sol、GPT-6 Luna；主会话与每个子会话可各自选模型，推理强度按模型暴露。Claude Code 只能跑 Claude 模型。**价值**：成本/能力可按任务分层，不被单一供应商锁定。

### 6.2 配置即代码的发行与回滚

`install --dry-run` → `install` → `status`（漂移哈希）→ `capture` → `rollback` → `clean`，配合 `provenance.json` 记录上游版本、base commit 与本地改动、pnpm 锁模板。安装器自动发现 `skills/<名称>/SKILL.md` 与同目录资源，并按上一次部署记录的 `sources` 清单清理已退役的模块与技能。Claude 有托管设置与插件策略，但没有等价的"整套 harness 可复现安装 + 漂移检测 + 一键回滚"。**价值**：换机、升级、回退都可验证，这是私人 agent 工作站的关键。

### 6.3 本地优先

会话、记忆、快照全在本机；没有云账户依赖。Claude 的跨端能力以云为中转（Remote Control 流量走 Anthropic 服务器，跨机会话消息也走服务器）。**价值**：敏感代码与合规场景，DSH 的边界更清楚。

### 6.4 可见的父子会话树

原生侧边栏层级、会话级进度、任务与最近回合回顾、并排分屏（复用原生会话引用与独立草稿）、后台完成通知（基于会话列表事件 + 2 秒轮询，首屏不重放、按 outcomeSeq 去重、静音可选）。限制：回顾只是原生每回合最多 120 字符的回复预览，不是模型另写的总结；任务面板最多 40 项；系统通知横幅已用隔离载体验证 show 事件，但物理横幅未完全验收；侧栏树依赖固定 `data-row-key`/ARIA 结构。Claude 的子代理在界面里不是一等会话；Agent Teams 虽可直聊 teammate，但仍标注实验性。**价值**：多任务并行时"谁在干什么"更直观。

### 6.5 跨工作区只读历史授权

按调用方发临时授权，读取其他工作区的会话名册/历史，不继承授权、不激活目标、不扩大族控制，并用授权版本栅栏处理异步撤销。Claude 的跨会话能力是消息而非受控读取。**价值**：在不合并工作区的前提下做跨项目参考，且权限可审计。

### 6.6 持久旁问（btw）

保留最近 20 对旁问（question 截 4000、answer 截 8000 字符），独立气泡、不污染主上下文；Ctrl+Alt+Shift+B 打开原生对话框，旁问使用自己的 textarea，不覆盖主输入草稿；可升级为带工具的新会话。限制：只接受文字、单进程最多 8 个并行旁问、每会话 20 个气泡、回答超时 30 分钟；`/btw-task` 只是 fork/新建一个普通可见会话，不是受调度的后台 job。Claude 桌面有 side chat，但 CLI 没有等价的持久旁问与升级路径。**价值**：打断式提问不破坏主线任务。

### 6.7 空闲期压缩

空闲 ≥54 分钟且估算 ≥200K tokens 时，由独立维护流程压缩，保留原始日志；设置界面可调；不同角色可用独立压缩引擎；已用 402,075 tokens 的真实代理做过验收。限制：全局同一时刻只跑一个摘要、只处理已加载会话、30 秒定时轮询，摘要本身消耗 token 且可能损失细节（文档明确不承诺省钱）。Claude 的压缩由上下文压力触发，没有"空闲即整理"这一维度；Claude 的定向摘要则支持"从此处 / 到此为止"两种方向。**价值**：长会话的冷启动成本更低。

### 6.8 内置浏览器批注

右侧浏览器支持截图与元素吸附：单击吸附 DOM 元素、拖动超 5 像素转为自由框选，浮动意见框随滚动保留；批注携带 CSS selector（最多 6 层、1200 字符）与 10 项计算样式，生成编号 PNG 后经原生草稿/发送接口回到绑定会话。Claude in Chrome 侧重操作网页，没有等价的"批注即证据"工作流。限制：跨源 iframe、Canvas、封闭 Shadow DOM 只能手动框选；未发送的批注不持久化；截图失败不会自动降级为纯文字；按钮挂载依赖宿主 DOM 结构，升级需重验。**价值**：前端返工沟通成本显著降低。

### 6.9 Windows 原生桌面控制

CUA 原生 provider 直接驱动 Windows 应用（UIA），配合内置浏览器与 Playwright，属于本仓库的一等能力。Claude 的 CLI computer use 仅 macOS，Windows 需要走桌面应用，且按应用逐次授权、有套餐限制。**价值**：纯 Windows 的内部工具自动化，DSH 的路径更直接；这不是 Claude 完全没有的能力，而是入口与约束不同。

### 6.10 规格交付闭环

OpenSpec 1.14.3 + `dsh-spec-delivery`：从提案到实现到归档的完整 skill 流程，结构校验。Claude 有 skills 机制但没有内置的规格交付方法论。**价值**：需求到代码的可追溯性。

### 6.11 中文一等公民

界面、文档、错误信息中文；本报告所依赖的仓库文档全中文。Claude Code 以英文为主。

### 6.12 本地环境（多仓库 + 变量 + 便携定义）

侧栏底部或设置页可保存一组仓库：每个仓库选当前目录，或从分支/标签/提交创建独立 worktree；变量按 `KEY=value` 字面量配置，存进原生凭据服务（只写、不回显），在会话内的原生 PowerShell/PTY 中生效，不修改宿主 `process.env`。定义可导出 JSON（不含本机路径和变量值），换机导入后重新绑定目录即可。启动会开新会话，**返回原会话**保留启动前草稿。Claude 有 worktree、`--add-dir` 与 Projects，但没有等价的"保存式环境定义 + 会话级变量绑定"。**价值**：多仓库任务和需要不同凭据/端点的会话不必手工导环境变量，也不会把值带进初始模型上下文。

### 6.13 会话级记忆禁写（强制边界）

用户说"本任务不写记忆"后，禁写不只约束模型：自动轮次摘要、子代理摘录、压缩摘要、合并，以及全部 `memory_*` 写工具都会被插件拦截；子会话继承父限制且不能放宽；后台生成结果写前复查；只读工具也不会借作用域初始化写入。Claude 的记忆是文件（CLAUDE.md / rules / auto memory），用户可以事后编辑，但没有同等的运行时会话级开关与继承语义。**价值**：处理敏感或临时任务时，"不要记住"从提示词约定变成可验收的执行约束。

### 6.14 确认式后续任务

回合结束后模型最多提议 3 个可选任务和 1 条输入建议；**确认前不执行**。确认后可独立启动（预检、固定已提交基线、每仓库独立原生 worktree 与独立会话）或排入当前会话（作为明确用户消息，不替换未发送草稿）。输入建议只在空白、无附件/引用/排队消息时显示，Tab/右方向键采纳为草稿，Enter 不发送；偏好可关闭并跨重启保留。建议复用本回合输出，不额外发后台推理请求。Claude 桌面有建议提示并可采纳，本仓库文档也明确只对齐操作契约、不声称私有实现相同；DSH 的差异在"确认后才创建隔离工作区"。

## 七、风险与验证边界

| 风险 | 说明 | 建议 |
|---|---|---|
| 插件与宿主强绑定 | 原生 `plugin peers check` 仍返回 1；本地模块绑定 0.2.1-rc.2；本地环境的 PowerShell/PTY 适配器以薄子类接入原生类 | 升级前做真实宿主验收，不只看单测；重点复核适配器断言的实际运行类 |
| 新能力只验收到装配层 | 三个模块与五个技能在隔离 `DSH_HOME` 中完成工具注册、技能解析与系统提示装配，但没有真实模型调用；`usage_report` 未端到端执行 | 用真实会话跑一次发送、用量汇总、审查与扫描，再写进能力承诺 |
| 本地审查技能能力有限 | `dsh-code-review` 无 effort 分级、`--comment`、`--fix`、结构化 findings；`scan.mjs` 是 12 条正则线索，没有依赖审计、污点分析或 SARIF | 当作第一道线索，不替代 SAST 或人工审查；不要宣称等价于 Claude 的托管审查 |
| 扫描脱敏范围 | 仅密钥类规则把命中替换为 `[redacted]`；非密钥规则输出截断后的原始匹配 | 扫描结果按敏感输出处理，不要直接贴进共享渠道 |
| 沙箱未验收 | 三档策略存在，但 OS 级文件/网络隔离无验收记录 | 处理不可信代码前补验收，或降到隔离环境 |
| 平台单一 | 验收以 Windows 为主（本地环境、PowerShell/PTY 也只在 Windows 实测） | 跨平台使用前重新验收浏览器、CUA 与本地环境 |
| 变量存储不加密 | 本地环境变量保存在原生凭据服务的文件记录中，文档明确"不能宣称加密"；导出定义不含变量值 | 不要把高敏感值放进共享环境；按 OS 账户隔离使用 |
| 多代理上限 | 只有两层；Team 与嵌套会话是两套机制；工作流并发 6、单次 64 | 大规模并行不要硬套，改用工作流或人工拆分 |
| 最松权限档 | `danger-full-access` 配 approval `never`；模板默认是 `workspace-write` | 按任务选择预设；不要把最松一档写进脚本或模板 |
| headless 功能面小 | 无 MCP / Team / worktree / plan mode / 空闲压缩 / 嵌套会话 / 新模块 | 不要把桌面能力写进无人值守流程 |
| 记忆并发 | MCP 进程不参与目录锁，可能与 DSH 插件并发写同一存储 | 同时使用两种入口时避免写入，或只读 |
| 第三方 bundle 未验收 | dshmarket、better-sidebar、code-review、skills-manager 等只锁定版本，源码与回归不在仓库 | 使用前单独验收，不把其行为写进能力承诺 |
| workflow / PTC 部分验收 | 并发 6、单次 64、`provider: spawn` 已由配置与单测固定；续跑、检查点与整体成本语义无仓库内记录 | 先用小规模任务实测，再用于长流程 |
| Claude 侧实验特性 | Agent Teams、dynamic workflows、agent view、routines 均标注实验/研究预览 | 对照时按"已发布但实验"计，不作为稳定基线 |
| 模型质量未比较 | 本报告不评价 DeepSeek / GLM / GPT-6 与 Claude 的推理差异 | 需要时单独做任务级评测，不要用功能表推断 |

## 八、优先级建议

### P0：补证据，不补功能（1–2 周）

1. 沙箱验收：文件写入边界、网络出口、子进程继承、审批绕过路径，在隔离 `DSH_HOME` 中记录。
2. 新能力端到端：在真实会话中执行 `message_session`、`usage_report`、`dsh-code-review` 与 `security-review/scan.mjs`，记录耗时、失败模式与限制。
3. 回退边界文档化：哪些改动被跟踪、保留多久、并发/子会话如何处理。
4. 修复 `plugin peers check` 或明确记录"不支持该检查"及替代验收方式。

### P1：补齐协作协议的缺口（1–2 月）

5. **Team 计划审批**：teammate 先只读规划、lead 批准后再执行。嵌套会话已能展示"计划待审"并记录拒绝，可先复用这套交互模型，但仍缺 Team 任务侧的审批动作。
6. **任务级 hook**：在任务创建/完成/成员空闲时执行校验命令，替代"人盯着看"。
7. **Team 界面**：成员分屏或独立会话视图。嵌套会话已有并排分屏与状态分组，Team 成员仍是 subagent，不进会话树、也没有独立视图。

### P2：可观测性（1–2 月，与 P1 并行）

8. 在 `usage_report` 之上补齐按工具/技能的 token 与耗时归因，并加成本告警；按会话（含子会话）的汇总已覆盖，不引入 OTel。
9. 审查技能的结构化输出：让 `dsh-code-review` 与 `scan.mjs` 产出可被脚本消费的 findings，并允许接入本地门禁。

### P3：生态（按需）

10. 插件来源与完整性校验（至少哈希 + 版本），不急于做市场。
11. 技能评测：本地跑一组固定任务，升级前后对比。

**不建议做**：云会话、手机端、IDE 插件、CI 集成。这些是产品形态差距，投入产出比低，且与"本地优先"的定位冲突。

## 九、证据索引

本仓库：

- `README.md`：定位、能力清单、两种历史层、安全边界
- `docs/AGENT-ENHANCEMENTS.md`：工作流、会话间消息、代码/安全审查、双浏览器链路、用量成本与 Claude 指令注入
- `docs/CODE-STRUCTURE.md`：模块职责与依赖规则
- `docs/NESTED-SESSIONS.md`：两层嵌套、消息、权限继承、跨工作区授权
- `docs/WORKTREE-DELIVERY.md`：隔离、集成、验收
- `docs/BROWSER-COMPUTER-USE.md`：Playwright、CUA、批注、边界
- `docs/IDLE-COMPACTION.md`：54 分钟 / 200K 阈值、真实代理验收
- `docs/VALIDATION.md`：验收记录与未完成项（含 2026-10-22 的装配层验收与限制）
- `docs/OPENSPEC.md`：规格交付流程
- `docs/NESTED-ACCEPTANCE.md`：R1–R9 逐项验收、117 项回归、远程边界
- `docs/FOLLOW-UPS.md`：确认式后续任务、输入建议与撤销边界
- `docs/MEMORY-WRITE-POLICY.md`：会话级禁写、子会话继承与异步复查
- `docs/local-environment-execution.md`：多仓库环境、变量、便携定义与实测证据
- `config/desktop.patch.json`：模型、预设、权限、插件装配
- `modules/`、`skills/`：本地模块与受管技能源码
- `test/*.test.mjs`：回归断言（含全局挂载、workflow 上限、扫码脱敏）
- `provenance.json`：运行时版本与本地模块记录

Claude 侧（公开文档，抓取于 2026-10-21）：

- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/cross-session-messaging
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/checkpointing
- https://code.claude.com/docs/en/agent-view
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/github-actions
- https://code.claude.com/docs/en/channels
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/claude-code-on-the-web
- https://code.claude.com/docs/en/remote-control
- https://code.claude.com/docs/en/monitoring-usage
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/desktop
- https://code.claude.com/docs/en/computer-use
- https://code.claude.com/docs/en/vs-code
- https://code.claude.com/docs/en/jetbrains
- https://code.claude.com/docs/en/mobile
- https://code.claude.com/docs/en/claude-projects
- https://code.claude.com/docs/en/auto-mode-config
- https://code.claude.com/docs/en/goal
- https://code.claude.com/docs/en/code-review
- https://code.claude.com/docs/en/ultrareview
- https://code.claude.com/docs/en/claude-security
- https://code.claude.com/docs/en/artifacts
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/managed-settings
- https://code.claude.com/docs/en/gateways
- https://code.claude.com/docs/en/zero-data-retention
- https://code.claude.com/docs/en/plugin-evals
- https://code.claude.com/docs/en/self-hosted-environments
- https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
