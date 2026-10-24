# Agent 能力增强（六项能力）

2026-10-22。桌面 profile 在原配置上增加了三个本地模块（`claude-context`、`usage-report`、`session-bus`）和六个技能（`workflow-orchestration`、`dsh-code-review`、`security-review`、`claude-context`、`usage-report`、`dynamic-ui`）。`dynamic-ui` 带 `patterns/` 子目录（19 个图元 + `manifest.json`）和 `preview.py` 自检脚本，部署时随技能目录整棵复制。`think`、`pua` 也已纳入 `skills/`，随安装器部署到 DSH 的 `agent-capabilities/skills/`，不再建目录联接；这些技能不写入 `~/.claude/skills` 等 agent 全局目录，避免被其他 agent 发现。全部是受管文件，安装后必须从菜单真正退出 Harness 再打开才加载。

2026-10-23 补充：又把 8 个下载技能（`ponytail`、`check`、`handoff`、`implement`、`grill-me`、`grill-with-docs`、`grilling`、`domain-modeling`）入仓，由安装器自动发现并部署，干净环境安装后即可复现。它们与 `think`、`pua` 一样只以仓库为准；`docs/SKILLS-ALIGNMENT.md` 附录只内联自维护的 `dynamic-ui`，下载技能一律只给 [`skills/`](../skills/) 下的仓库链接。

三个模块都挂在**顶层全局 insert**，与原生 `working-directory`、`browser-guidance` 同级，而不是放进 preset。preset 会为每个 Agent 实例化一份插件：`session-bus` 若在 preset 内，第二个 Agent 打开同一 storage domain 会直接失败；`usage-report` 和 `claude-context` 也不需要重复实例。工具仍通过 `agent.ctx.tools.register` 按 Agent 注册，子代理不获得 `message_session`。

## 工作流编排

工作流不再只挂上游包。`plugins/workflow-ptc` 与 `plugins/tool-workflow` 从 0.2.1-rc.2 tag 的源码构建（`provenance.json` 绑定该原生运行时），只增加治理字段，不改既有脚本语义。配置仍为 `provider: spawn`、并发 16、单次运行最多 1000 个子代理：

```json
"workflow-ptc": {"provider": "spawn", "maxConcurrentAgents": 16, "maxTotalAgents": 1000}
```

四项对齐能力：

- **规模指引**：`tool-workflow` 的 `sizeGuideline`（默认 `medium`）按 small / medium / large 在工具描述里写明预期规模，并把对应的 5 / 10 / 25 个代理作为运行告警阈值；越过阈值时引擎告警，单次调用可通过 `warnAboveAgents` 覆盖。
- **整体预算**：单次调用用 `budget_tokens` / `budget_ms` 收紧（只能低于引擎配置），脚本侧另有只读 `budget` 全局，提供 `total`、`spent()`、`remaining()`、`elapsedMs()`、`timeRemainingMs()`。越过预算后的下一次 `agent()` 被拒绝，已收集的结果仍可返回。
- **嵌套限制**：工作流子代理不能再启动工作流（工具描述写作 `one level only`），与 Claude 的一层嵌套一致；子代理里仍可调用普通 `subagent`。
- **检查点 / 续跑**：v2 journal 记录运行身份、调用意图、启动与结果及终态。原会话、实际目录、沙箱、模型、预算、脚本和输入必须一致；只回放已确认完成的结果。一个来源只能产生一个续跑后继，后继继续保留回放结果。遇到损坏、失败或不确定的子调用时拒绝重跑。
- **schema 失败重试**：仅 read-only 沙箱下允许对缺少 structured 值的已完成子调用使用配置的 schemaRetries。具有写权限时不自动重试，防止重复副作用；失败、取消或缺少有效结果的子调用不能包装成整体成功。

`workflow-orchestration` 技能负责“什么时候用”：一两项委派走普通 `subagent`；多路独立审计、迁移、跨文件排查才用 `workflow`。技能同时写明实际契约：`meta` 与 `script` 分开传、`args` 必须是对象、`agent()` 失败返回 `null`、优先 `pipeline()` 而不是阶段屏障、重要发现做对抗验证。

边界：工作流子级显式使用父会话当前 cwd；不保证继承 preset 或 reasoning effort；一层嵌套的代价是“子代理里想再拆，只能把结果交回父级再编排”。token 预算要求宿主已挂载 `session-query`，只统计已结算子会话的 `tokenUsage` 投影，回放调用不计；没有该服务时只能设时长预算。每次 schema 重试都是一次完整的子代理运行，成本按尝试累加，真实模型下重试能否修正 structured 输出尚未验收。journal 含 prompt 文本，只落在 `DSH_HOME` 下，不纳入 Git。原生 subagent 活跃槽位已从默认 8 调到 20，工作流占 16，手工 `subagent` 保留 4；这些是协作式配额，不是硬性调度保证。工作流在被调用方的文件沙箱策略下运行，不能用来绕过权限。

## 委派入口对照

三个入口都通过原生 `ctx.subagents` seam 启动子级，可以同时启用，不占同一个槽位，只共享子代理深度与活跃槽位额度；它们是叠加关系，不是替代关系。

| 入口 | 形态 | 能拿到什么 | 位置 |
|---|---|---|---|
| `subagent` / `subagent_fork` | 进程内子会话 | 子会话可打开可回看；`send_message` 中途引导、`interrupt_agent` 停当前轮但保留收件箱与后代、`list_agents` 列举；`fork` 带父会话前缀 | `delegation` 组的 `@deepseek-ai/dsh-tool-subagent` |
| Team（`agent-team-local` / `tool-agent-team-local`） | 本地改造的多智能体 | 成员名册、共享任务 DAG、计划审批、Hook 事件、worktree 前置 | `modules/team.mjs`、`modules/team-tools.mjs`；模板中原生 `agent-team` / `tool-agent-team` 为 `disabled` |
| Claude Code 子智能体（`@deepseek-ai/dsh-subagent-claude-code`） | 原生可选 bundle，独立进程 | 一段任务文本进、最终答案出；推理、工具通信、stderr、工作区 diff 不回流 | 原生插件页开关；本机在 `node_modules/.ignored/`，未启用 |

- 「Harness增强」里的「团队协作」开关控制上表第二行那两个本地文件。原生 experimental team 包在模板里是 `disabled`，所以打开开关得到的是改造版（计划审批、Hook、worktree 前置），不是原生版。
- Claude Code 子智能体是唯一一条「换执行栈」的入口：自带平台锁定的运行时，不会回退到宿主的 `claude` 可执行文件；沿用 `~/.claude` 的原生设置与身份验证，`env` 叠在剥离凭据的父环境之上，`permissionMode` 默认 `dontAsk`。它适合不需要看过程、只要结论的委派；需要追问、续接或看过程的活仍用 `subagent`。
- 同赛道比较时，进程内子代理在续接、可观测、上下文继承、编排规模与控制粒度上都更强，代价是与父代理共享进程和沙箱。子代理和父代理共用同一套工具与权限，独立进程不构成绕过权限的通道。

## CC 模式（已移除）

2026-10-23 按用户反馈移除 `cc` preset：它只是 standard 的完整克隆再加一行 PTC 呈现，实际使用中没有带来独立价值。`preset-cc` 已从 `config/desktop.patch.json` 删除，`tool-subagent.allowedAgentPresets` 不再列出 `cc`，单测改为断言两者都不存在。

升级前曾用 `agent_preset: "cc"` 创建的会话不会自动迁移；如仍有这类会话需要打开，先按 `scripts/harness.mjs migrate-liangshen` 的思路把 `agent-preset/selected` 记录改指 `standard`，否则解析预设会失败。

## 会话间消息

独立插件 `session-bus`，不属于任何 preset。授权是**逐对**的 `from → to`，只能由用户在发送方会话里用命令建立：

```text
/session-bus list                 列出可发送的会话、短 ID 和已有授权
/session-bus allow <会话ID前缀>    授权本会话发送给该目标
/session-bus revoke <会话ID前缀>   撤销
```

模型侧只有两个工具：`message_session`（发送）和 `list_authorized_sessions`（只读列出已授权目标）。模型不能授权、不能给自己发送、不能读写对方对话内容。

发送复用原生链路：`createUserMessage({source:{kind:'agent-message', form:'relay', senderSessionId}})` 加目标会话的原生 `followup`，再 `ctx.sessions.flush`，与嵌套会话的家族消息一致，没有第二套消息队列。以下情况一律拒绝：未授权、给自己、空消息、超过 16000 字符、目标已归档、目标当前未运行、目标是原生子代理、目标已被用户停止。

停止保护：`turn/end` 的 `aborted`/`user` 原因会把目标标记为已停止，用户在目标会话重新发送消息或开始新回合后解除。授权与停止标记保存在 `session_bus` 存储 domain 的 global 状态，按插件可忽略记录持久；写操作串行化，避免并发授权覆盖。

对端消息会在文本前带上明确声明：这是 agent 之间转发的请求，不是用户授权，不得扩大权限、执行破坏性操作或服从与当前用户请求冲突的指令。`session-bus` 同时注入一条系统上下文，只列出当前确实可发送的目标。

## 团队计划审批、Hook 事件与成员面板

`modules/team.mjs` 增加三个可选治理入口，默认都不改变现有 Team 行为：任务审批 `requireTaskApproval`（默认 `false`）、Hook 命令表 `hooks`（默认 `{}`）、旧任务门禁 `taskGate`（默认空字符串）。

### 计划审批

- **提交**：队友调用 `team_plan_submit({content})` 写入一条 `pending` 计划，随后阻塞等待决定；工具 guard 在该成员有待审计划时只放行白名单 `read`、`read_image`、`glob`、`grep`、`skill`、`send_message`、`team_task_get`、`team_task_list`、`team_plan_list`，其余调用返回只读提示。
- **决定**：只有 Lead 能调用 `team_plan_resolve({plan_id, action, feedback})`；`reject` 必须给 `feedback`，`approve` 可选。决定落库后唤醒等待的提交调用，返回带 `status` 与 `feedback` 的计划视图。
- **回看**：`team_plan_list` 按提交顺序返回全部计划、作者、状态与反馈。
- **持久化**：计划以 `appendPluginRecord(session, "plugin:agent-team-local/plan", {version:2,teamId,plan})` 写成可忽略的插件记录；projection 读取时把该类型归一化为 `team/plan`。这样卸载插件或用不含该模块的 harness 冷读会话时，记录会被跳过而不是报 `SessionFormatUnsupportedError`。仓库内已提交的自动回归只覆盖 `team-view` 客户端（`test/team-view-client.test.cjs`）；计划与 Hook 的实机验收脚本放在本机 `.local`（不入库），见 `docs/VALIDATION.md` 的 2026-10-23 一节。
- 语义与原生计划模式不同：成员不会自动切换权限模式，而是主动调用工具进入"待审只读"；决定返回后同一工具调用继续，不自动开新回合。

### Hook 事件

`hooks` 是 `{TaskCreated?, TaskCompleted?, TeammateIdle?}`，值可以是命令字符串或字符串数组；同名事件按声明顺序串行执行。未配置时，`TaskCreated` / `TaskCompleted` 回退到旧的 `taskGate`，`TeammateIdle` 只在 `hooks.TeammateIdle` 存在时运行。

- **任务事件**：把 `{type, hook_event_name, teamId, session_id, task, task_id, task_subject, task_description, teammate_name?}` 写到命令 stdin，超时 10 秒；退出码 0 放行，2 抛 `TEAM_TASK_BLOCKED` 并带上 stderr，其他非 0 或超时记 `TEAM_TASK_GATE_FAILED`。创建事件在写入共享任务之前执行，完成事件在提交完成之前执行。
- **空闲事件**：队友的 `agent/turn-stopping` 触发，stdin 为 `{type:"TeammateIdle", hook_event_name, teamId, session_id, teammate_name}`；退出码 2 不停止本轮，而是把 stderr 作为反馈 steer 回该成员继续工作。一个回合可能多次触发 `turn-stopping`，因此同一回合可产生多条 Hook 记录，调用方应按语义而非次数解释。
- 超时在 Windows 上用 `taskkill /T` 结束整个进程树（`spawn(shell:true)` 下 `kill()` 只到 cmd.exe）；POSIX 仍只结束 shell，Hook 自己派生的后代可能继续运行，需要 Hook 自行清理。

### 成员面板

`plugins/team-view` 是浏览器端插件（`@local/dsh-team-view`，`dsh.client.platform: "web"`），在侧栏页脚注册 `Team` 入口：面板读取当前选中会话的 `agentTeam` 投影（成员会话则回退到其 Lead），列出成员名、`active`/`provisioning` 状态、进行中任务数与待审计划数，并提供：

- `并排打开`：把成员会话以原生 `subagentchat` 资源打开在右侧栏，不替换主视图；
- `在主视图打开` / `回到 Lead 视图`：切换 `uiWorkspace` 选择；
- `全部并排`：逐个打开可用的成员，并报告打不开的成员。

面板只读投影与调用公开会话接口，不直接改会话记录。已验收：隔离宿主安装后在 Web UI 选中 Lead 会话，面板列出真实模型队友 `worker`，点击 `并排打开` 在右侧栏出现该成员的 `READY` 回合。

配置入口：当前模板 `config/desktop.patch.json` 只为该模块登记 id 与入口，没有向模块传配置的通道。因此 `requireTaskApproval`、`hooks` 与 `taskGate` 只能写进生成后的本机配置（或在 profile overlay 的模块块里给 `config`），重新生成会丢失；要长期启用，需要先给部署模板补上模块配置通道。

## 代码审查

`dsh-code-review` 是只读审查技能：先定范围（工作区改动、提交区间、PR、文件集），再读改动周围完整函数和调用方，按正确性、回归、权限与信任边界、资源、可维护性分维度检查，最后对抗自检后给出 `file:line` 证据。没有发现时说明检查范围和未覆盖项；未要求就不改代码。

参数：`effort low|medium|high`（默认 `medium`）、`--comment`（按行内评论交付）、`--fix`（审查后应用最小修复）、`--json`。`--json` 输出固定契约，便于脚本消费：

```json
{"schemaVersion":1,"findings":[{"severity":"high|medium|low","kind":"correctness|regression|permission|resource|maintainability","file":"path/to/file.ext","line":123,"summary":"一句话结论","trigger":"具体输入或状态","impact":"错误行为/数据损坏/权限提升","evidence":"相关代码或测试输出","suggestion":"最小修复方向","confidence":"confirmed|pending"}]}
```

技能名不是 `code-review`，因为 DSH 的外部技能 provider（`~/.codex/skills`、`~/.claude/skills`、`~/.agents/skills`）优先级高于桌面 `customSkillDirs`，同名会被覆盖。安装器同时保留旧名用于清理旧部署。

## 安全审查

`security-review` 是技能加同目录只读脚本 `scan.mjs`：

```powershell
node .\scan.mjs <目标路径> --json
```

脚本跳过 `.git`、`node_modules`、`build`、`dist`、`.local`、符号链接和二进制/超大文件，默认最多 20000 个文件，输出中的密钥一律 `[redacted]`。输出带 `schemaVersion: 1`。命中只是审查线索，不是确认漏洞；必须回到源码确认可达性。`--fail-on high|medium|low` 用于门禁：本仓库接成 `npm run scan:security`（`--fail-on high`，只有 high 命中返回 1），`npm run check` = `npm test` + 该扫描；缺值或非法值返回 2，不会静默放行。

人工部分按信任边界而不是文件清单走：入口验证、授权、注入、文件与进程、凭据、网络、依赖供应链、失败模式和数据保留。只做无害复现，不执行破坏性命令、不横向移动、不外传数据。

## 浏览器

保持两个 Playwright MCP 服务，用工具前缀区分：

- `mcp__playwright__browser_*`：`--isolated` 全新隔离浏览器，用于公开页面和无需登录的操作。
- `mcp__playwright-session__browser_*`：持久 profile `DSH_HOME/browser-profiles/playwright-session`，输出目录 `DSH_HOME/browser-output-session`，用于需要保留登录态的场景。

两个服务的 `--browser` 都写作模板令牌 `${BROWSER}`，安装时按本机 settings 的 `browser` 渲染，模板里不再留死值。持久 profile **不继承用户日常浏览器的登录态**，需要在该窗口里单独登录一次；它也不是安全边界，不要把高权限账号长期留在里面。两个服务都不改写浏览器安全配置。`browser-guidance` 的提示文本同时说明了这两条链路的区别（并修正了模板字符串里的反引号语法错误）。详见 [浏览器与桌面控制](BROWSER-COMPUTER-USE.md)。

## 可观测性/成本

`usage_report` 工具读取原生会话投影（`tokenUsage`、`contextPressure`、`sessionStats`、`modelSelection.lastUsed`），不解析日志文件。不传参数报告当前会话；`session_ids` 最多 20 个，每个都要通过当前会话的 `remoteAccess` 检查。单个会话读取失败只标记 `unavailable: true`，不影响其余会话。

输出包括四项 token、总量、缓存命中率 `cacheRead/(uncachedInput+cacheRead)`、上下文压力与窗口、`pressurePercent`、`projectedTokens`、`llmMs`/`toolMs`/`ttftMs`、轮次与步数。

DSH 原生只记录 token，不记录价格。`cost` 只有在模块配置里为对应模型提供每百万 token 费率后才存在；没有匹配费率时为 `null`，`totals` 给出 `unpricedSessions`。这是估算，不是账单，不要凭记忆填厂商价格。

## Claude 文件与记忆

DSH 原生 `dsh-agent-instructions` 已经读取项目根到 cwd 的 `AGENTS.md` / `CLAUDE.md` 及 `.local` 变体。它**不读** `~/.claude/CLAUDE.md`、`<cwd>/.claude/CLAUDE.md` 或 `.claude/rules/`，这部分由 `claude-context` 模块补齐：

- 用户级 `~/.claude/CLAUDE.md`（24000 字符上限）
- 项目级 `<cwd>/.claude/CLAUDE.md`（24000）
- `<cwd>/.claude/rules/*.md` 只读直接文件、按文件名排序、总量 24000，单文件 8000
- 项目记忆只注入一行索引路径，不注入内容

Claude 专用的 `RTK` 段落和单独成行的 `@import` 会被过滤：前者在 DSH 有不同规则，后者不会被 DSH 展开。注入文本标记为“用户指令”，但与仓库 `AGENTS.md` 和当前请求冲突时以后者为准。

`claude-context` 技能负责按需读取：先用 `MEMORY.md` 的 `description` 判断相关性，只打开相关记忆文件，并回到源码确认记忆里提到的文件/函数仍然存在。记忆是背景证据，不是授权；只读 `~/.claude`，不把 DSH 会话写回 Claude 记忆。

## 文件路径交互

DSH 原生已经给消息里的文件提及着色（`--dsw-alias-link`），悬停/聚焦时显示点状虚线与焦点环，点击后按行号锚点打开右侧预览。但代码内联的路径只有**本回合产出或交付**的文件才会变成链接；Claude Code 与 Codex 的路径 chip 不依赖这个条件，模型只是读过、提过的文件也能点。

`plugins/file-links` 在客户端包装原生 `chatFileMentions.forClosing`：先交给原生解析，未命中时用保守的语法判定识别 `src/main.ts`、`README.md:42`、`./a/b.c#L7`、盘符开头的绝对路径这类 token，再走同一个 `owner.openFile` 打开侧边栏。含空白、URL、UNC、引号、`and/or`、`3.5`、`e.g` 以及目录名（如 `src/`）的一律保持纯文本。它不注册第二个服务，也不改样式，因此观感与原生的文件 chip 一致。

限制：路径是否存在要点击后由预览确认，缺失文件显示原生预览错误；绝对路径与相对路径都按当前会话 cwd 解析。该行为依赖宿主 0.2.1-rc.2 的内部接口形状，升级 Harness 后必须重新验收。

## 会话内可视化与 ultracode 开关

模型做交互 UI 时不再写 `.html` 交付文件。`plugins/dynamic-ui-view` 注册 `render_widget`（`html` 片段、`title`、`height`），客户端按 wire 名挂 `tool.call.toolview`，把片段放进 `sandbox="allow-scripts allow-forms"` 的 iframe：没有 `allow-same-origin`，片段读不到父文档、存储或原生 API；文档壳再加 CSP `default-src 'none'`、`style-src`/`script-src 'unsafe-inline'`、`img-src data: blob:`、`connect-src 'none'`，禁掉全部网络。片段上限 200000 字符，`height` 只作为初始帧高夹在 200–900；带 `<!doctype>`/`<html>`/`<body>` 的整页会被拒绝，模型据错误重试。卡片高度最终由内容决定：文档壳在片段后追加一段内联脚本，用 `ResizeObserver` 量 `body.scrollHeight` 并 `postMessage` 上报，父文档只接受来自该帧的消息，夹在 200–2400 后设给 iframe，因此内容不会被固定高度裁掉；极长内容超过 2400 时仍由外层滚动。`skills/dynamic-ui` 的通道 1 已改用它，写文件交付降为兜底。宿主会把完成的工具调用折进 `hidden="until-found"`（先是「已完成，用时…」，再是「已调用工具」两级）。`tool.call.toolview` 槽位在工具调用节点内部，卡片必然跟着折叠，所以客户端改为搬出去渲染：卡片旁留一个隐藏锚点，挂载后用 `MutationObserver` 监听 `hidden` 属性、`childList` 与子树变化，沿祖先找最外层折叠分组，把 `.dyn-widget-host` 容器插到该分组之后，再用 `createPortal` 把卡片渲染进去——分组保持原生折叠，卡片独立完整显示。锚点不在折叠区时收回容器、卡片退回槽位内联；宿主重建节点导致容器脱落时下一次 DOM 变化会重新插入。工具描述同时要求片段不要自带固定高度加 `overflow` 的滚动容器，高度一律交给卡片按内容撑开，不再依赖用户提醒。这段 DOM 适配只在客户端单点实现，固定宿主 0.2.1-rc.2，升级须重验。

`plugins/ultracode-control` 在 composer 工具行、模型选择器左侧放一个 `role="switch"` 药丸。状态读原生 `ultracode` projection；会话还没写过记录（`active: null`）时显示「Harness增强」里的新会话默认值。点击只发送现有 `/ultracode on|off`，切换会像 `/permission` 一样在会话里留下原生命令节点；不新增记录、不复制设置。开启时药丸带缓慢流光与呼吸点，`prefers-reduced-motion: reduce` 下全部静止。

策略段本身只在该 agent 作用域内 `workflow` 工具可见时注入。本部署的 PTC 由安装器复用 standard 的能力配置，仅将工具呈现改成 PTC；因此可在 run_code 内调用 workflow。explore/planner/reviewer 三个只读角色预设没有 delegation 组，minimal 也没有 workflow，这些模式不会收到指向不存在工具的指令。判据取 `ctx.tools.get("workflow", agent)` 的可见性而不是预设名，新增预设无需维护白名单。工具名与 `tool-workflow` 的 `toolName` 配置耦合，模板目前不改它；药丸通过带会话访问检查的 ultracodeState/read 查询实际能力；不支持时显示“不可用”并禁用，查询失败显示“状态未知”，显式关联分工显示“协作优先”。

限制：模型弹出菜单（`conversation.input.model`）是 single 槽，宿主只允许一个占用者，无法在其中加行，所以开关放在同一行的左侧而非菜单内；该位置也是会话作用域，每个会话独立。

## 验收

- 完整 `rtk npm test` 143 项通过，无跳过；新增工作流上限与全局挂载、CC preset 克隆关系、session-bus 授权/停止/去重、usage 计算与无价格、安全扫描脱敏与目录跳过、claude-context 过滤与 project slug 等断言。
- 隔离 DSH_HOME 完整安装后，用安装版同一 Electron 运行时启动桌面 profile：`ENHANCED_ACCEPTANCE_PASS`，确认 `usage_report`、`message_session`、`list_authorized_sessions` 三个工具注册，两个 Playwright 服务前缀都存在，五个技能解析到 `agent-capabilities/skills/`，`/session-bus list` 返回 success，装配后的系统提示含 `claude-context`（含合成标记）与 `session-bus`。`dynamic-ui` 在该次验收之后加入，只验证了部署映射（`patterns/*.md` 与 `preview.py` 进部署清单）、本地自检和真实宿主 `@agent-deck/visualize.render` 渲染，没有重跑整轮隔离安装。
- CC 模式：隔离 `DSH_HOME` 重新安装后，standard 会话解析为 `native` 且 `workflow` 直接可见；`agentPreset: "cc"` 会话解析为 `ptc`，模型可见工具只有 `run_code`，输出 `CC_PRESET_ACCEPTANCE_PASS`。
- 工作流治理在隔离 `DSH_HOME` 中完成宿主验收（`WORKFLOW_ACCEPTANCE_PASS`）：`workflow` 工具暴露 `resume_from_run_id`、`budget_tokens`、`budget_ms`，描述含规模指引、续跑与 `one level only`；引擎装配为并发 16 / 总量 1000 / journal 开启；真实运行生成 call/result journal；`resume_from_run_id` 的新运行只写 header；在活跃工作流子会话上再启动工作流被拒绝；`maxDurationMs: 300` 的运行在 604 ms 时拒绝第二次 `agent()`。该 home 没有模型凭据，子代理通过宿主注册的 stub provider 启动，因此真实模型的 token 预算触发未验收；token 读取所用的 `tokenUsage` 投影四字段已单独确认。
- 未做真实模型调用：本次环境没有可用的 `OPENAI_API_KEY`，验收止于原生装配层。`usage_report` 的端到端工具调用也因此没有实跑，只验证了注册与字段映射；CC 模式同样没有执行真实的 `run_code` 程序。
- 验收期间原生 `spill-local` 输出过一次临时目录 `EPERM` 警告，宿主仍正常启动并完成验收；与本仓库模块无关。
- 文件路径链接：`test/file-links-client.test.cjs` 4 项断言通过，完整 `npm test` 149 项通过；`install --refresh-lock` 部署后 `status` 无漂移，已确认客户端 bundle 落在默认 `DSH_HOME` 的 `node_modules/@local/dsh-file-links/lib/`。未在运行中的窗口里实际悬停并点击链接。
- 真实宿主验收必须固定宿主版本；升级 Harness 后重新验收，不能只改版本号。


## Ultracode 与显式工作流入口

- Ultracode 是自动编排偏好：实质性任务优先考虑工作流，小任务可直接完成或使用普通子代理。模型负责选择，原生运行时保留权限、深度、并发与取消约束。
- `/collaborate on` 明确选择持久关联会话，优先于 Ultracode 默认偏好；`/collaborate auto` 恢复按需选择。关联工作会话只执行分配的任务，不被 Ultracode 再次自动拆成第二套编排。
- `/collaborate off` 只禁用新的关联会话，不关闭普通子代理或工作流，也不停止已有任务。人工停止不能通过更换委派工具规避。
- `/workflow 任务内容` 为当前任务显式选择工作流，优先于常驻偏好，不改 Ultracode 或 collaborate 开关。无参数显示用法；无工具、超长输入或取消时不提交任务。进度与结果复用原生工作流卡片；后台执行通过 `job_output` 收取结果、`job_kill` 停止。
- `/ultracode status` 区分关闭、实际生效、无工具未生效、关联会话优先和关联工作会话。输入框开关展示宿主实际能力与模式；不支持时禁用，偏好被保留但不亮起。
- `nestedSessions.delegationMode(sessionId)` 是供编排策略读取的同步公共接口，仅返回 `auto`、`linked`、`worker` 或 `off`。Ultracode 不读取关联插件存储，不写其策略。
- 完成条件是证据与交付验收，不是代理启动数量。后台任务必须取得终态结果；失败、缺失和预算截断须明确报告。

隔离真实模型验收：先将本配置安装到独立 `DSH_HOME`，设置该 home、匹配的 `DSH_NATIVE_ROOT` 和仅进程内的 `OPENAI_API_KEY`，运行 `node scripts/harness.mjs orchestration-test --home <隔离目录>`。底层脚本为 `scripts/test-orchestration-policy.cjs`，设置 `DSH_VERIFY_ORCHESTRATION_ONLY=1` 可直接运行底层脚本只做冷读核验。测试简单任务、自动工作流、显式关联会话和一次性工作流，使用 `workspace-write`，不提供权限覆盖。


PTC 的 `run_code` 是工具呈现方式，不是更宽权限。它使用与 standard 相同的受管工具配置，通过原生 SDK 调用 workflow；保留原并发、深度、预算与沙箱。Workflow 记录器也对 PTC 子调用写原生运行记录，支持冷读结果。能力查询不追加历史记录，前端取消失效请求并隔离会话切换后的响应；最多每 5 秒刷新挂载中的状态。

PTC 验收在隔离 home 设置 `DSH_TEST_PRESET=ptc` 后执行 orchestration-test。先通过真实模型调用 run_code 验证工作区内写入成功、只读写入拒绝和工作区外原生文件写入拒绝，再执行四种委派场景。取消请求不得落盘。`DSH_VERIFY_ORCHESTRATION_ONLY=1` 用于后续冷读核验。


## 失败、停止与安全续跑

`/workflow resume <运行ID>` 复用原脚本与参数，`/workflow stop <运行ID>` 等待原生子代理收尾；这两个入口挂在与工作流引擎相同的原生 delegation 作用域中。没有新增调度服务。后台运行继续使用原生任务控制。

v2 journal 绑定 owner、实际目录、沙箱、模型、资源预算、脚本与输入。同一会话有活动或未确认运行时拒绝新启动；旧运行只能生成一个后继；后继保存回放结果。缺失、损坏、旧版或不确定的记录一律拒绝自动重跑。停止/失败锁跨重启保留，只能由用户经既有 /workflow 明确解除；解除授权绑定该条用户请求，其他消息不能冒用。

恢复允许的是“已完成步骤回放结果，尚未开始步骤继续”。子代理失败或停止时可能已经写文件，无法据此保证重复执行无副作用，所以先拒绝并要求核对文件。具有写权限的 schema 失败不自动重试；清理未确认时不释放活动运行占用，也不报告停止完成。回滚保留 journal 和业务文件，旧实现不能续跑 v2 日志。

停止或失败后的普通 `/workflow 继续` 不会解除锁；必须提供原运行 ID 续跑，或核对文件后明确 `/workflow new 新任务`。未确认清理或宿主崩溃留下的活动占用不会自动清除，避免旧执行尚未退出时并发写入。

## 自动选择三种委派方式的真实验收

在安装好的隔离 DSH_HOME 中运行 `node scripts/harness.mjs ultracode-routing-test --home <隔离目录>`。沿用既有真实模型凭据注入方式，不把凭据写进测试文件。脚本只打开 `/ultracode on` 和 `/collaborate auto`，任务提示描述需求，不指定委派工具；分别在 Standard、PTC 检查：日志上下文隔离、持久调查分支、分阶段批量写入、同文件两项更新。

验收核对实际工具调用、子任务完成状态、写入前后内容、写入者生命周期及真实 sandbox mode/workspaceRoot。三个路由样本分别检查选中的方式，普通旁支只派一次，持久调查恰好两个分支；共享文件场景允许合理组合不同工具，但同文件只允许单写者或先后交接，拒绝并行写者与重复增量。记录仅保留在隔离 home，不进入 Git。`DSH_ROUTING_RECHECK=<该次证据目录>` 可冷启动读取原生会话和已有记录重新验收，不重新派发任务或重置文件；`DSH_TEST_PRESET`、`DSH_ROUTING_CASE` 可缩小检查范围。
